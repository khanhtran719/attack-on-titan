class_name TitanPlayer
extends CharacterBody3D
## Fixed physics owner for local traversal, including the capsule and two rope constraints.

signal landed(fall_speed: float)
signal died
signal damaged(amount: float)
signal perfect_dodged
signal dodge_started
signal boost_changed(boosting: bool)
signal hook_changed(side: String, latched: bool)
signal hook_fired(side: String)
signal hook_latched(at: Vector3)
signal physics_sampled(frame: Dictionary)
signal grab_released(escaped: bool)

const OrbitCamera = preload("res://player/orbit_camera.gd")
const OdmController = preload("res://player/odm_controller.gd")
const PlayerAnimation = preload("res://player/player_animation.gd")
const PlayerPose = preload("res://player/player_pose.gd")
const Motion = preload("res://player/player_motion.gd")
const InputPrediction = preload("res://player/input_prediction.gd")
const MODEL_PATH = "res://assets/vanguard.glb"
const MAX_HEALTH: float = 100.0
const MAX_GAS: float = 100.0
const MAX_BLADE_DURABILITY: float = 100.0
const MAX_SPARE_BLADES: int = 6
const MAX_THUNDER_SPEARS: int = 4
const WORLD_LAYER: int = 1
const BODY_LAYER: int = 2
const DODGE_DURATION: float = 0.38
const PERFECT_DODGE_WINDOW: float = 0.20

const KEYS := {
	&"move_forward": [KEY_W, KEY_UP], &"move_back": [KEY_S, KEY_DOWN],
	&"move_left": [KEY_A, KEY_LEFT], &"move_right": [KEY_D, KEY_RIGHT],
	&"jump": [KEY_SPACE], &"grapple_left": [KEY_Z], &"grapple_right": [KEY_X],
	&"boost": [KEY_SHIFT], &"dodge": [KEY_Q], &"attack": [KEY_F],
	&"thunder_spear": [KEY_V], &"lock_target": [KEY_TAB], &"cycle_zone_next": [KEY_C],
	&"cycle_zone_prev": [], &"resupply": [KEY_R], &"interact": [KEY_E], &"ping": [KEY_G],
	&"quick_chat_1": [KEY_1], &"quick_chat_2": [KEY_2], &"quick_chat_3": [KEY_3], &"quick_chat_4": [KEY_4],
	&"tactical_overlay": [KEY_H, KEY_QUOTELEFT], &"pause": [KEY_ESCAPE, KEY_P]
}
const BUTTONS := {
	&"grapple_left": [MOUSE_BUTTON_LEFT], &"grapple_right": [MOUSE_BUTTON_RIGHT],
	&"lock_target": [MOUSE_BUTTON_MIDDLE], &"cycle_zone_next": [MOUSE_BUTTON_WHEEL_DOWN],
	&"cycle_zone_prev": [MOUSE_BUTTON_WHEEL_UP]
}

var active: bool = true
var control_enabled: bool = true
var health: float = MAX_HEALTH
var gas: float = MAX_GAS
var blade_durability: float = MAX_BLADE_DURABILITY
var spare_blades: int = MAX_SPARE_BLADES
var thunder_spears: int = MAX_THUNDER_SPEARS
var grounded: bool = false
var is_boosting: bool = false
var yaw: float = PI
var dodge_timer: float = 0.0
var dodge_cooldown: float = 0.0
var invulnerability_timer: float = 0.0
var total_grapples_fired: int = 0
var total_swings_time: float = 0.0
var total_boost_time: float = 0.0
var total_dodges: int = 0
var total_perfect_dodges: int = 0
var locked_target: Node3D
var locked_target_position: Variant = null
var grabbed_by: Node3D
var grab_escape_progress: float = 0.0
var grab_hold_remaining: float = 0.0
var grapple_preview: Dictionary = {}
var downed: bool = false

var camera: OrbitCamera
var odm: OdmController
var animation_state: StringName:
	get:
		return _animator.current if _animator != null else &"Idle"
var camera_yaw: float:
	get:
		return camera.yaw
var camera_pitch: float:
	get:
		return camera.pitch

var _model: Node3D
var _animator: PlayerAnimation
var _pose: PlayerPose
var _lateral_accel: float = 0.0
var _left_winch: Node3D
var _right_winch: Node3D
var _thruster_nozzle: Node3D
var _blade_markers: Array[Node3D] = []
var _blade_meshes: Array[Node3D] = []
var _last_frame: Dictionary = {}
var _preview_time: float = 0.0
var _in_grab: bool = false
var _grab_forward := Vector3.FORWARD
var _grab_protected_by_server: bool = false
var _prediction := InputPrediction.new()
var _replay_snapshot: Dictionary = {}
var _force_snapshot: Dictionary = {}


static func install_inputs() -> void:
	for action: StringName in KEYS:
		if InputMap.has_action(action):
			continue
		InputMap.add_action(action)
		for code: Key in KEYS[action]:
			var event := InputEventKey.new()
			event.physical_keycode = code
			InputMap.action_add_event(action, event)
		for button: MouseButton in BUTTONS.get(action, []):
			var event := InputEventMouseButton.new()
			event.button_index = button
			InputMap.action_add_event(action, event)


static func set_tactical_overlay_key(use_tab: bool) -> void:
	install_inputs()
	var tab := InputEventKey.new()
	tab.physical_keycode = KEY_TAB
	var t_key := InputEventKey.new()
	t_key.physical_keycode = KEY_T
	if use_tab:
		InputMap.action_erase_event(&"lock_target", tab)
		if not InputMap.action_has_event(&"lock_target", t_key):
			InputMap.action_add_event(&"lock_target", t_key)
		if not InputMap.action_has_event(&"tactical_overlay", tab):
			InputMap.action_add_event(&"tactical_overlay", tab)
	else:
		InputMap.action_erase_event(&"tactical_overlay", tab)
		InputMap.action_erase_event(&"lock_target", t_key)
		if not InputMap.action_has_event(&"lock_target", tab):
			InputMap.action_add_event(&"lock_target", tab)


func _ready() -> void:
	install_inputs()
	collision_layer = BODY_LAYER
	collision_mask = WORLD_LAYER
	safe_margin = 0.01
	floor_snap_length = 0.18
	var capsule := CapsuleShape3D.new()
	capsule.height = 1.8
	capsule.radius = 0.35
	var shape := CollisionShape3D.new()
	shape.shape = capsule
	shape.position.y = 0.9
	add_child(shape)

	camera = OrbitCamera.new()
	camera.name = "ActionCamera"
	add_child(camera)
	camera.make_current()
	odm = OdmController.new()
	odm.name = "ODM"
	add_child(odm)
	odm.exclude_body(self)
	odm.hook_changed.connect(func(side: String, latched: bool) -> void: hook_changed.emit(side, latched))

	_animator = PlayerAnimation.new()
	add_child(_animator)
	_load_model()
	camera.reset_view(global_position, yaw)


func _load_model() -> void:
	if not ResourceLoader.exists(MODEL_PATH):
		return
	var scene := load(MODEL_PATH) as PackedScene
	if scene == null:
		return
	_model = scene.instantiate() as Node3D
	add_child(_model)
	_model.rotation.y = yaw
	_animator.setup(_model)
	var skeletons := _model.find_children("*", "Skeleton3D", true, false)
	if not skeletons.is_empty():
		_pose = PlayerPose.new()
		skeletons[0].add_child(_pose)
	_left_winch = _model.find_child("LeftWinch", true, false) as Node3D
	_right_winch = _model.find_child("RightWinch", true, false) as Node3D
	_thruster_nozzle = _model.find_child("ThrusterNozzle", true, false) as Node3D
	for marker_name in ["LeftSwordHilt", "LeftSwordTip", "RightSwordHilt", "RightSwordTip"]:
		_blade_markers.append(_model.find_child(marker_name, true, false) as Node3D)
	for mesh_name in ["LeftBlade", "RightBlade"]:
		var mesh := _model.find_child(mesh_name, true, false) as Node3D
		if mesh != null:
			_blade_meshes.append(mesh)


func capture_pointer() -> void:
	if active and control_enabled and not is_dead() and DisplayServer.get_name() != "headless":
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func release_pointer() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _unhandled_input(event: InputEvent) -> void:
	if not active or not control_enabled or is_dead():
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		camera.add_mouse_delta(event.screen_relative)
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE]:
			capture_pointer()


func _notification(what: int) -> void:
	if what != NOTIFICATION_APPLICATION_FOCUS_OUT:
		return
	for action: StringName in KEYS:
		if InputMap.has_action(action) and Input.is_action_pressed(action):
			Input.action_release(action)
	if camera != null:
		camera.clear_mouse_delta()


func respawn(feet: Vector3, facing: float = PI) -> void:
	_prediction.clear()
	_replay_snapshot.clear()
	_force_snapshot.clear()
	global_position = feet
	reset_physics_interpolation()
	velocity = Vector3.ZERO
	yaw = facing
	_lateral_accel = 0.0
	grounded = false
	health = MAX_HEALTH
	gas = MAX_GAS
	blade_durability = MAX_BLADE_DURABILITY
	spare_blades = MAX_SPARE_BLADES
	thunder_spears = MAX_THUNDER_SPEARS
	downed = false
	dodge_timer = 0.0
	dodge_cooldown = 0.0
	invulnerability_timer = 0.0
	_clear_grab()
	locked_target = null
	locked_target_position = null
	total_grapples_fired = 0
	total_boost_time = 0.0
	total_swings_time = 0.0
	total_dodges = 0
	total_perfect_dodges = 0
	_set_boost(false)
	odm.reset()
	_animator.reset()
	if _model != null:
		_model.rotation.y = facing
	camera.reset_view(feet, facing)
	camera.reset_physics_interpolation()


func resupply() -> void:
	gas = MAX_GAS
	blade_durability = MAX_BLADE_DURABILITY
	spare_blades = MAX_SPARE_BLADES
	thunder_spears = MAX_THUNDER_SPEARS
	health = minf(MAX_HEALTH, health + 45.0)


func reload_blades() -> bool:
	if blade_durability >= MAX_BLADE_DURABILITY or spare_blades <= 0:
		return false
	blade_durability = MAX_BLADE_DURABILITY
	spare_blades -= 1
	return true


func is_dead() -> bool:
	return health <= 0.0 and not downed


func is_grabbed() -> bool:
	return _in_grab or _grab_protected_by_server


func damage(amount: float, knockback: Vector3 = Vector3.ZERO) -> bool:
	if amount <= 0.0 or _immune_to_hit():
		return false
	health = maxf(0.0, health - amount)
	invulnerability_timer = 0.85
	velocity = knockback.normalized() * 14.0
	velocity.y = 7.5
	grounded = false
	if is_dead():
		_die()
	else:
		play_action(&"HitReaction")
	damaged.emit(amount)
	return true


func capture_by_titan(marker: Node3D, amount: float, titan_forward: Vector3 = Vector3.FORWARD) -> bool:
	if not is_instance_valid(marker) or _in_grab or _immune_to_hit():
		return false
	odm.release_all()
	_set_boost(false)
	grounded = false
	health = maxf(0.0, health - amount)
	damaged.emit(amount)
	if is_dead():
		_die()
		return false

	grabbed_by = marker
	_in_grab = true
	_grab_forward = titan_forward
	grab_hold_remaining = 3.5
	grab_escape_progress = 0.0
	velocity = Vector3.ZERO
	play_action(&"HitReaction")
	return true


func release_grab(escaped: bool = false) -> void:
	if not _in_grab:
		return
	velocity = -_grab_forward * 14.0 if escaped else _grab_forward * 15.0
	velocity.y = 12.5 if escaped else 8.0
	invulnerability_timer = 1.25 if escaped else 0.85
	_clear_grab()
	grab_released.emit(escaped)


func play_action(clip: StringName, duration: float = -1.0) -> void:
	_animator.play_action(clip, duration)


func blade_segments() -> Array[PackedVector3Array]:
	var result: Array[PackedVector3Array] = []
	if _blade_markers.size() != 4:
		return result
	for index in [0, 2]:
		var hilt := _blade_markers[index]
		var tip := _blade_markers[index + 1]
		if hilt != null and tip != null:
			var end := tip.global_position if blade_durability > 0.0 else hilt.global_position.lerp(tip.global_position, 0.25)
			result.append(PackedVector3Array([hilt.global_position, end]))
	return result


func thruster_position() -> Vector3:
	return _marker_world(_thruster_nozzle, Vector3(0.0, 0.85, -0.25))


func aim_direction() -> Vector3:
	return camera.forward()


func move_direction() -> Vector3:
	var axes := _movement_axes()
	return (camera.right() * axes.x + camera.flat_forward() * axes.y).limit_length(1.0)


func net_input_state() -> Dictionary:
	return _last_frame.duplicate(true)


func record_prediction(sequence: int, frame: Dictionary) -> void:
	_prediction.record(sequence, frame, global_position, odm.left_hook, odm.right_hook)


func apply_server_snapshot(
	net_player: Dictionary, _elapsed: float, marker_left: Node3D = null,
	marker_right: Node3D = null, sync_hooks: bool = true
) -> void:
	var was_dead := is_dead()
	var was_downed := downed
	var was_grabbed := _grab_protected_by_server
	var life_state := str(net_player.get("lifeState", "alive"))
	downed = life_state == "downed"
	_grab_protected_by_server = net_player.get("grabbedByTitanId") != null
	health = float(net_player.get("health", health))
	gas = float(net_player.get("gas", gas))
	blade_durability = float(net_player.get("bladeDurability", blade_durability))
	spare_blades = int(net_player.get("spareBlades", spare_blades))
	thunder_spears = int(net_player.get("thunderSpears", thunder_spears))
	grab_escape_progress = float(net_player.get("grabEscapeProgress", grab_escape_progress))
	var position_from_server := InputPrediction.vector(net_player.get("position"), global_position)
	var ack := int(net_player.get("lastAckedSeq", 0))
	var needs_correction := _prediction.consume_snapshot(ack, position_from_server)

	if downed or is_dead() or _grab_protected_by_server or was_dead or was_downed or was_grabbed:
		_force_snapshot = net_player.duplicate(true)
		_replay_snapshot.clear()
	elif needs_correction:
		_replay_snapshot = net_player.duplicate(true)
	elif not _replay_snapshot.is_empty() and ack > int(_replay_snapshot.get("lastAckedSeq", 0)):
		_replay_snapshot.clear()
	if downed and not was_downed:
		play_action(&"HitReaction", INF)
	elif is_dead() and not was_dead:
		_die()
	elif not downed and not is_dead() and (was_downed or was_dead):
		_animator.reset()
	if sync_hooks and not downed and not is_dead() and not _grab_protected_by_server:
		var left: Dictionary = net_player.get("leftHook", {})
		var right: Dictionary = net_player.get("rightHook", {})
		if not left.is_empty() and _prediction.left_is_acknowledged(ack):
			odm.sync_hook_from_server("left", left, marker_left)
		if not right.is_empty() and _prediction.right_is_acknowledged(ack):
			odm.sync_hook_from_server("right", right, marker_right)


func _apply_queued_snapshot() -> void:
	if not _force_snapshot.is_empty():
		global_position = InputPrediction.vector(_force_snapshot.get("position"), global_position)
		velocity = InputPrediction.vector(_force_snapshot.get("velocity"), velocity)
		grounded = bool(_force_snapshot.get("grounded", grounded))
		yaw = float(_force_snapshot.get("yaw", yaw))
		reset_physics_interpolation()
		_force_snapshot.clear()
	if _replay_snapshot.is_empty():
		return
	var replayed := _prediction.replay(self, _replay_snapshot)
	_replay_snapshot.clear()
	var error: Vector3 = replayed.position - global_position
	if error.length() <= InputPrediction.CORRECTION_THRESHOLD:
		return
	if error.length() > InputPrediction.SNAP_DISTANCE:
		global_position = replayed.position
		velocity = replayed.velocity
		grounded = replayed.grounded
		reset_physics_interpolation()
	else:
		move_and_collide(error * 0.35)
		velocity = velocity.lerp(replayed.velocity, 0.25)


func _physics_process(dt: float) -> void:
	if not active:
		return

	_apply_queued_snapshot()
	camera.update_view(dt, global_position, velocity, is_boosting, _locked_position())
	dodge_timer = maxf(0.0, dodge_timer - dt)
	dodge_cooldown = maxf(0.0, dodge_cooldown - dt)
	invulnerability_timer = maxf(0.0, invulnerability_timer - dt)

	var previous_left := odm.left_hook.active
	var previous_right := odm.right_hook.active
	var steer := move_direction() if control_enabled else Vector3.ZERO
	if _grab_protected_by_server or downed:
		odm.release_all()
		_set_boost(false)
	elif is_dead():
		_step_dead(dt)
	elif _in_grab:
		_step_grab(dt)
	else:
		_step_live(dt, steer)
	_send_frame(dt, previous_left, previous_right)
	_update_presentation(dt)


func _step_live(dt: float, steer: Vector3) -> void:
	var had_ground := grounded
	_handle_hook("left", &"grapple_left", dt)
	_handle_hook("right", &"grapple_right", dt)
	if gas <= 0.0:
		odm.release_all()
	var hooks := odm.refresh_anchors(global_position, dt)
	if not hooks.is_empty():
		grounded = false

	_handle_dodge(steer)
	if _pressed(&"jump"):
		if grounded:
			grounded = false
			velocity.y = 10.5
			play_action(&"Jump")
		elif not hooks.is_empty():
			velocity.y = maxf(velocity.y + 6.5, 10.5)
	_handle_boost(dt)
	var fall_velocity := velocity.y
	floor_snap_length = 0.18 if grounded else 0.0
	if not hooks.is_empty():
		total_swings_time += dt
		gas = maxf(0.0, gas - 3.5 * dt)
	elif grounded:
		gas = minf(MAX_GAS, gas + 2.5 * dt)
	var integrated := Motion.integrate(global_position, velocity, grounded, steer,
		camera.forward(), is_boosting, dodge_timer > 0.0, hooks, dt)
	velocity = integrated.velocity
	if not integrated.correction.is_zero_approx():
		move_and_collide(integrated.correction)
	fall_velocity = minf(fall_velocity, velocity.y)
	move_and_slide()
	grounded = hooks.is_empty() and is_on_floor() and velocity.y <= 0.5
	if grounded:
		if not had_ground and fall_velocity < -9.5:
			play_action(&"Landing")
			landed.emit(-fall_velocity)
		velocity.y = 0.0
	_update_yaw(dt)


func _handle_hook(side: String, action: StringName, dt: float) -> void:
	if odm.update_held(side, _held(action), _pressed(action), gas, global_position,
			camera.global_position, camera.forward(), locked_target, dt):
		total_grapples_fired += 1
		grounded = false
		if velocity.y < 3.5:
			velocity.y += 3.5
		var hook := odm.left_hook if side == "left" else odm.right_hook
		hook_fired.emit(side)
		hook_latched.emit(hook.anchor_position)


func _handle_dodge(steer: Vector3) -> void:
	if not _pressed(&"dodge") or dodge_cooldown > 0.0 or gas < 4.0:
		return
	dodge_timer = DODGE_DURATION
	dodge_cooldown = 0.75
	gas -= 4.0
	total_dodges += 1
	velocity = (steer if steer.length_squared() > 0.05 else camera.flat_forward()) * 22.0
	if not grounded:
		velocity.y = maxf(4.0, velocity.y)
	play_action(&"Dodge")
	dodge_started.emit()


func _handle_boost(dt: float) -> void:
	_set_boost(_held(&"boost") and gas > 0.5)
	if not is_boosting:
		return
	gas = maxf(0.0, gas - 13.5 * dt)
	total_boost_time += dt


func _set_boost(boosting: bool) -> void:
	if is_boosting != boosting:
		is_boosting = boosting
		boost_changed.emit(boosting)


func _step_dead(dt: float) -> void:
	if downed:
		return
	velocity.y += Motion.GRAVITY * dt
	velocity.x *= 0.92
	velocity.z *= 0.92
	move_and_slide()
	grounded = is_on_floor()
	if grounded:
		velocity = Vector3.ZERO


func _step_grab(dt: float) -> void:
	if not is_instance_valid(grabbed_by) or not bool(grabbed_by.get_meta("grapple_active", true)):
		_clear_grab()
		invulnerability_timer = 1.0
		velocity = Vector3.UP * 9.5
		grab_released.emit(false)
		return
	odm.release_all()
	_set_boost(false)
	grounded = false
	global_position = grabbed_by.global_position
	velocity = Vector3.ZERO
	health = maxf(0.0, health - 10.0 * dt)
	if is_dead():
		grab_released.emit(false)
		_die()
		return
	if _pressed(&"attack") or _pressed(&"jump") or _pressed(&"thunder_spear"):
		var step := 1.0 if _pressed(&"thunder_spear") else 0.38
		grab_escape_progress = minf(1.0, grab_escape_progress + step)
		play_action(&"HeavyAttack")
		if grab_escape_progress >= 1.0:
			release_grab(true)
			return
	grab_hold_remaining -= dt
	if grab_hold_remaining <= 0.0:
		release_grab(false)


func _clear_grab() -> void:
	grabbed_by = null
	_in_grab = false
	_grab_protected_by_server = false
	grab_escape_progress = 0.0
	grab_hold_remaining = 0.0


func _die() -> void:
	_clear_grab()
	odm.release_all()
	_set_boost(false)
	play_action(&"Death")
	died.emit()


func _immune_to_hit() -> bool:
	if is_dead() or downed:
		return true
	if dodge_timer > DODGE_DURATION - PERFECT_DODGE_WINDOW:
		total_perfect_dodges += 1
		invulnerability_timer = 0.7
		perfect_dodged.emit()
		return true
	return dodge_timer > 0.0 or invulnerability_timer > 0.0


func _update_yaw(dt: float) -> void:
	var horizontal_speed := Vector2(velocity.x, velocity.z).length()
	_lateral_accel = 0.0
	if horizontal_speed > 0.8:
		var previous := yaw
		var target := atan2(velocity.x, velocity.z)
		yaw = lerp_angle(yaw, target, minf(1.0, (14.0 if grounded else 12.0) * dt))
		_lateral_accel = angle_difference(previous, yaw) * horizontal_speed * 0.15 / maxf(0.001, dt)


func _update_presentation(dt: float) -> void:
	if _model != null:
		_model.rotation.y = yaw
		for blade in _blade_meshes:
			blade.scale.z = 1.0 if blade_durability > 0.0 else 0.25
	_animator.update_state(
		dt, grounded, Vector2(velocity.x, velocity.z).length(), velocity.y,
		is_boosting, odm.left_hook.active, odm.right_hook.active
	)
	if _pose != null:
		_pose.feet = global_position
		_pose.yaw = yaw
		_pose.speed = Vector2(velocity.x, velocity.z).length()
		_pose.vertical_speed = velocity.y
		_pose.lateral_accel = _lateral_accel
		_pose.grounded = grounded
		_pose.animation = animation_state
		_pose.left_anchor = odm.left_hook.anchor_position if odm.left_hook.active else null
		_pose.right_anchor = odm.right_hook.anchor_position if odm.right_hook.active else null
	var left_winch := _marker_world(_left_winch, Vector3(-0.30, 1.0, 0.0))
	var right_winch := _marker_world(_right_winch, Vector3(0.30, 1.0, 0.0))
	odm.update_visuals(left_winch, right_winch)

	_preview_time -= dt
	if _preview_time <= 0.0 and not is_dead():
		_preview_time = 0.10
		grapple_preview = odm.probe(global_position, camera.global_position, camera.forward(), 0, locked_target)


func _marker_world(marker: Node3D, default_offset: Vector3) -> Vector3:
	return marker.global_position if is_instance_valid(marker) else global_position + default_offset.rotated(Vector3.UP, yaw)


func _locked_position() -> Variant:
	if is_instance_valid(locked_target):
		return locked_target.global_position
	return locked_target_position


func _movement_axes() -> Vector2:
	return Vector2(Input.get_axis(&"move_left", &"move_right"), Input.get_axis(&"move_back", &"move_forward"))


func _pressed(action: StringName) -> bool:
	return control_enabled and Input.is_action_just_pressed(action)


func _held(action: StringName) -> bool:
	return control_enabled and Input.is_action_pressed(action)


func _send_frame(dt: float, previous_left: bool, previous_right: bool) -> void:
	var axes := _movement_axes() if control_enabled else Vector2.ZERO
	var left := odm.left_hook
	var right := odm.right_hook
	_last_frame = {
		"dt": dt, "moveForward": axes.y, "moveRight": axes.x,
		"jumpPressed": _pressed(&"jump"), "boostHeld": _held(&"boost"),
		"dodgePressed": _pressed(&"dodge"), "resupplyPressed": _pressed(&"resupply"),
		"reviveHeld": _held(&"interact"), "yaw": camera.yaw, "pitch": camera.pitch,
		"camOrigin": _vector_array(camera.global_position), "camForward": _vector_array(camera.forward()),
		"camRight": _vector_array(camera.right()),
		"leftGrappleAction": _net_hook_action(&"grapple_left", previous_left, left.active),
		"rightGrappleAction": _net_hook_action(&"grapple_right", previous_right, right.active),
		"leftGrappleTarget": _vector_array(left.anchor_position) if left.active and not left.follows_target else null,
		"rightGrappleTarget": _vector_array(right.anchor_position) if right.active and not right.follows_target else null,
		"escapePressed": _pressed(&"attack") or _pressed(&"jump") or _pressed(&"thunder_spear")
	}
	physics_sampled.emit(_last_frame)


func _net_hook_action(action: StringName, previous: bool, latched: bool) -> String:
	if _pressed(action) or (latched and not previous):
		return "fire"
	if _held(action):
		return "hold"
	return "release" if previous and not latched else "none"


func _vector_array(value: Vector3) -> Array[float]:
	return [value.x, value.y, value.z]
