extends RefCounted
## Replays unacknowledged movement using the same forces and a read-only capsule sweep.

const Motion = preload("res://player/player_motion.gd")
const RopeSolver = preload("res://player/rope_solver.gd")
const MAX_HISTORY: int = 120
const CORRECTION_THRESHOLD: float = 0.45
const SNAP_DISTANCE: float = 6.0

var _history: Array[Dictionary] = []
var _last_left_action: int = 0
var _last_right_action: int = 0


func clear() -> void:
	_history.clear()
	_last_left_action = 0
	_last_right_action = 0


func record(
	sequence: int, frame: Dictionary, position: Vector3,
	left: RopeSolver.Hook, right: RopeSolver.Hook
) -> void:
	if sequence <= 0:
		return
	if frame.get("leftGrappleAction") in ["fire", "release"]:
		_last_left_action = sequence
	if frame.get("rightGrappleAction") in ["fire", "release"]:
		_last_right_action = sequence
	_history.append({
		"seq": sequence, "frame": frame.duplicate(true), "position": position,
		"left": left.anchor_position if left.active else null,
		"right": right.anchor_position if right.active else null,
		"left_moves": left.follows_target, "right_moves": right.follows_target
	})
	if _history.size() > MAX_HISTORY:
		_history.pop_front()


func left_is_acknowledged(sequence: int) -> bool:
	return sequence >= _last_left_action


func right_is_acknowledged(sequence: int) -> bool:
	return sequence >= _last_right_action


func consume_snapshot(sequence: int, position: Vector3) -> bool:
	var predicted: Variant = null
	while not _history.is_empty() and int(_history[0].seq) <= sequence:
		var sample: Dictionary = _history.pop_front()
		if sample.seq == sequence:
			predicted = sample.position
	return predicted is Vector3 and position.distance_to(predicted) > CORRECTION_THRESHOLD


func replay(body: CharacterBody3D, snapshot: Dictionary) -> Dictionary:
	var feet := vector(snapshot.get("position"), body.global_position)
	var speed := vector(snapshot.get("velocity"), body.velocity)
	var grounded := bool(snapshot.get("grounded", false))
	var left := _from_snapshot(snapshot.get("leftHook", {}))
	var right := _from_snapshot(snapshot.get("rightHook", {}))
	var dodge_time: float = 0.0
	for sample in _history:
		var frame: Dictionary = sample.frame
		var dt := clampf(float(frame.get("dt", 1.0 / 60.0)), 0.0, 1.0 / 30.0)
		if dt <= 0.0:
			continue
		var yaw := float(frame.get("yaw", 0.0))
		var forward := Vector3(-sin(yaw), 0.0, -cos(yaw))
		var camera_right := Vector3(cos(yaw), 0.0, -sin(yaw))
		var aim := vector(frame.get("camForward"), forward).normalized()
		var steer := (forward * float(frame.get("moveForward", 0.0)) + camera_right * float(frame.get("moveRight", 0.0))).limit_length()
		var hooks: Array[RopeSolver.Hook] = []
		if _apply_hook(left, frame.get("leftGrappleAction", "none"), sample.left, sample.left_moves, feet):
			if speed.y < 3.5:
				speed.y += 3.5
		if _apply_hook(right, frame.get("rightGrappleAction", "none"), sample.right, sample.right_moves, feet):
			if speed.y < 3.5:
				speed.y += 3.5
		for hook in [left, right]:
			if hook.active and feet.distance_to(hook.anchor_position) <= 88.0 * 1.22:
				hooks.append(hook)
			else:
				hook.active = false
		if not hooks.is_empty():
			grounded = false

		dodge_time = maxf(0.0, dodge_time - dt)
		if bool(frame.get("dodgePressed", false)) and dodge_time <= 0.0:
			dodge_time = 0.38
			speed = (steer if steer.length_squared() > 0.05 else forward) * 22.0
			if not grounded:
				speed.y = maxf(4.0, speed.y)
		if bool(frame.get("jumpPressed", false)):
			if grounded:
				grounded = false
				speed.y = 10.5
			elif not hooks.is_empty():
				speed.y = maxf(speed.y + 6.5, 10.5)

		var integrated := Motion.integrate(feet, speed, grounded, steer, aim,
			bool(frame.get("boostHeld", false)), dodge_time > 0.0, hooks, dt)
		var movement := _move_capsule(body, feet, integrated.velocity, integrated.correction, dt)
		feet = movement.position
		speed = movement.velocity
		grounded = hooks.is_empty() and movement.grounded
	return {"position": feet, "velocity": speed, "grounded": grounded}


func _move_capsule(body: CharacterBody3D, feet: Vector3, speed: Vector3, correction: Vector3, dt: float) -> Dictionary:
	var parameters := PhysicsTestMotionParameters3D.new()
	var result := PhysicsTestMotionResult3D.new()
	parameters.margin = body.safe_margin
	if not correction.is_zero_approx():
		parameters.from = Transform3D(body.global_basis, feet)
		parameters.motion = correction
		if PhysicsServer3D.body_test_motion(body.get_rid(), parameters, result):
			feet += result.get_travel()
		else:
			feet += correction

	var remaining := speed * dt
	var grounded: bool = false
	for i in 4:
		if remaining.length_squared() < 0.00000001:
			break
		parameters.from = Transform3D(body.global_basis, feet)
		parameters.motion = remaining
		if not PhysicsServer3D.body_test_motion(body.get_rid(), parameters, result):
			feet += remaining
			break
		feet += result.get_travel()
		var normal := result.get_collision_normal()
		grounded = grounded or (normal.dot(Vector3.UP) > 0.71 and speed.y <= 0.5)
		if speed.dot(normal) < 0.0:
			speed = speed.slide(normal)
		remaining = result.get_remainder().slide(normal)
	if grounded:
		speed.y = 0.0
	return {"position": feet, "velocity": speed, "grounded": grounded}


func _apply_hook(
	hook: RopeSolver.Hook, action: String, hint: Variant, follows_target: bool, feet: Vector3
) -> bool:
	if action == "release":
		hook.active = false
	elif action == "fire" and hint is Vector3:
		hook.active = true
		hook.follows_target = follows_target
		hook.anchor_position = hint
		hook.rest_length = maxf(RopeSolver.MIN_LENGTH, feet.distance_to(hint))
		return true
	elif hook.active and hook.follows_target and follows_target and hint is Vector3:
		hook.anchor_position = hint
	return false


func _from_snapshot(state: Dictionary) -> RopeSolver.Hook:
	var hook := RopeSolver.Hook.new()
	hook.active = bool(state.get("active", false))
	hook.follows_target = state.get("attachedTitanId") != null
	hook.anchor_position = vector(state.get("anchor"), Vector3.ZERO)
	hook.rest_length = float(state.get("restLength", RopeSolver.MIN_LENGTH))
	return hook


static func vector(value: Variant, fallback: Vector3) -> Vector3:
	if value is Array and value.size() == 3:
		return Vector3(float(value[0]), float(value[1]), float(value[2]))
	return fallback
