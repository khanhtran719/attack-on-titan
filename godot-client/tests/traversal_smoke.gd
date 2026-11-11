extends SceneTree

const PLAYER_SCRIPT = "res://player/player.gd"
const RopeSolver = preload("res://player/rope_solver.gd")
var failures: int = 0


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	_verify_rope_math()
	if not ResourceLoader.exists(PLAYER_SCRIPT):
		_check(false, "player runtime exists")
		quit(1)
		return
	var player_script: GDScript = load(PLAYER_SCRIPT)
	var player: CharacterBody3D = player_script.new()
	_box(Vector3(0, -0.5, 0), Vector3(150, 1, 150), false)
	_box(Vector3(0, 8, -28), Vector3(14, 16, 4), true)
	root.add_child(player)
	player.respawn(Vector3(0, 0.1, 0), PI)
	await _ticks(14)
	_check(player.grounded, "the capsule settles on the world floor")

	Input.action_press("move_forward")
	await _ticks(36)
	Input.action_release("move_forward")
	_check(player.position.z < -3.0, "camera-relative forward movement travels north")
	_check(player.animation_state in [&"Run", &"Walk"], "locomotion selects a ground animation")

	Input.action_press("jump")
	await _ticks(2)
	Input.action_release("jump")
	await _ticks(18)
	_check(player.position.y > 1.0 and not player.grounded, "jump raises the feet above the floor")
	await _ticks(60)
	_check(player.grounded, "the jump returns to the floor")

	player.respawn(Vector3(0, 0.1, 0), PI)
	await _ticks(12)
	Input.action_press("grapple_left")
	Input.action_press("grapple_right")
	await _ticks(5)
	_check(player.odm.left_hook.active and player.odm.right_hook.active, "both wires attach to a facade")
	_check(player.odm.left_hook.anchor_position.x < player.odm.right_hook.anchor_position.x,
		"independent hook rays bias opposite sides")
	var initial_rest: float = player.odm.left_hook.rest_length
	var initial_gas: float = player.gas
	Input.action_press("boost")
	await _ticks(12)
	Input.action_release("boost")
	_check(player.odm.left_hook.rest_length < initial_rest, "reeling shortens the rope")
	_check(player.gas < initial_gas and player.total_boost_time > 0.1, "boost consumes gas and advances drill stats")
	var approach_speed: float = player.velocity.length()
	Input.action_release("grapple_left")
	Input.action_release("grapple_right")
	await _ticks(2)
	_check(not player.odm.any_active(), "releasing both controls detaches both wires")
	_check(player.velocity.length() > approach_speed * 0.65, "release preserves most swing momentum")

	player.respawn(Vector3(0, 0.1, -22), PI)
	await _ticks(12)
	Input.action_press("move_forward")
	Input.action_press("boost")
	await _ticks(90)
	Input.action_release("move_forward")
	Input.action_release("boost")
	_check(player.position.z > -26.0, "capsule cannot cross the solid facade")

	player.respawn(Vector3(0, 0.1, 0), PI)
	await _ticks(12)
	Input.action_press("dodge")
	await _ticks(2)
	Input.action_release("dodge")
	_check(not player.damage(28.0) and is_equal_approx(player.health, 100.0),
		"perfect-dodge window prevents damage")
	_check(player.total_perfect_dodges == 1, "perfect dodge is recorded")
	await _ticks(60)
	_check(player.damage(28.0) and is_equal_approx(player.health, 72.0),
		"damage resumes when dodge immunity expires")

	await _verify_camera_and_anchors(player)
	await _verify_animation_and_grab(player)
	await _verify_prediction(player)

	if failures == 0:
		print("PASS traversal: movement, jump, dual hooks, reeling, boost, release, wall, dodge, camera, moving anchors, rig, grab and prediction")
	quit(1 if failures > 0 else 0)


# Expected results are from the Three.js solveODMRopeConstraints at dt = 1/60.
func _verify_rope_math() -> void:
	var slack := RopeSolver.Hook.new()
	slack.anchor_position = Vector3(3, 4, -8)
	slack.rest_length = 12.0
	var result := RopeSolver.solve(Vector3.ZERO, Vector3(8, 3, 1), [slack], Vector3.FORWARD, false, 1.0 / 60.0)
	_check(not slack.taut and absf(slack.rest_length - 9.617314465) < 0.00001, "single slack rope matches source reel")
	_check(result.velocity.distance_to(Vector3(8.836868326, 4.115824435, -2.200927235)) < 0.00001,
		"single slack rope matches source tangential velocity")

	var left := RopeSolver.Hook.new()
	left.anchor_position = Vector3(8, 15, -24)
	left.rest_length = 15.0
	var right := RopeSolver.Hook.new()
	right.anchor_position = Vector3(-6, 14, -25)
	right.rest_length = 14.0
	result = RopeSolver.solve(Vector3(0, 4, 0), Vector3(12, -4, 18), [left, right], Vector3.RIGHT, true, 1.0 / 60.0)
	_check(left.taut and right.taut and absf(left.rest_length - 14.45) < 0.00001 and absf(right.rest_length - 13.45) < 0.00001,
		"both taut ropes preserve independent lengths")
	_check(result.correction.distance_to(Vector3(0.007249994, 0.076124941, -0.177624861)) < 0.00001,
		"dual hook soft correction matches source")
	_check(result.velocity.distance_to(Vector3(14.542855558, 22.105066158, -42.424891306)) < 0.00001,
		"dual hook steering and boost match source")


func _verify_camera_and_anchors(player: CharacterBody3D) -> void:
	var nearby_wall := _box(Vector3(0, 4, 1.5), Vector3(10, 8, 1), false)
	player.respawn(Vector3(0, 0.1, 0), PI)
	await _ticks(12)
	_check(player.camera.global_position.z < 1.0, "camera collision pulls the view in before the wall")
	nearby_wall.queue_free()
	await _ticks(28)
	_check(player.camera.global_position.z > 3.0, "camera restores its trailing distance after leaving a wall")

	var blocker := _box(Vector3(0, 4, -8), Vector3(12, 8, 1), false)
	var marker := Marker3D.new()
	marker.position = Vector3(0, 4, -16)
	marker.add_to_group("grapple_zone")
	marker.set_meta("grapple_radius", 1.0)
	marker.set_meta("titan_id", "traversal_test")
	marker.set_meta("zone", "Nape")
	root.add_child(marker)
	player.locked_target = marker
	await _ticks(8)
	_check(not player.grapple_preview.has("target"), "solid geometry hides the locked Titan anchor")
	blocker.queue_free()
	await _ticks(8)
	Input.action_press("grapple_left")
	await _ticks(4)
	_check(player.odm.left_hook.active and player.odm.left_hook.target == marker, "locked Titan marker takes priority")
	marker.position.x += 3.0
	await _ticks(3)
	_check(player.odm.left_hook.anchor_position.is_equal_approx(marker.global_position), "latched anchor follows a moving zone")
	marker.remove_from_group("grapple_zone")
	await _ticks(2)
	_check(not player.odm.left_hook.active, "the wire detaches when the Titan zone is disabled")
	Input.action_release("grapple_left")
	player.locked_target = null
	marker.queue_free()


func _verify_animation_and_grab(player: CharacterBody3D) -> void:
	player.respawn(Vector3(0, 0.1, 0), PI)
	await _ticks(12)
	var blades: Array[PackedVector3Array] = player.blade_segments()
	_check(blades.size() == 2, "both imported hand socket pairs are available")
	if blades.size() == 2:
		_check(is_equal_approx(blades[0][0].distance_to(blades[0][1]), 0.98), "blade sockets preserve source reach")
	player.play_action(&"HeavyAttack", 0.62)
	await _ticks(10)
	var swung: Array[PackedVector3Array] = player.blade_segments()
	_check(player.animation_state == &"HeavyAttack", "attack animation takes precedence over locomotion")
	if blades.size() == 2 and swung.size() == 2:
		_check(blades[0][1].distance_to(swung[0][1]) > 0.12, "the imported attack clip moves the blade socket")
	await _ticks(30)
	_check(player.animation_state == &"Idle", "animation returns to locomotion after an action")

	var hand := Marker3D.new()
	hand.position = Vector3(2, 5, -4)
	root.add_child(hand)
	_check(player.capture_by_titan(hand, 20.0, Vector3.FORWARD), "a valid Titan can capture the player")
	await _ticks(6)
	_check(player.is_grabbed() and player.global_position.is_equal_approx(hand.global_position),
		"grab tracks the Titan hand")
	_check(player.health < 80.0, "a grab applies crush damage over time")
	Input.action_press("thunder_spear")
	await _ticks(2)
	Input.action_release("thunder_spear")
	_check(not player.is_grabbed() and player.velocity.y > 9.0, "escape inputs launch the player out of a grab")
	hand.queue_free()


func _verify_prediction(player: CharacterBody3D) -> void:
	player.respawn(Vector3(0, 0.1, 0), PI)
	await _ticks(12)
	Input.action_press("grapple_left")
	await _ticks(2)
	_check(player.odm.left_hook.active, "local prediction immediately attaches a hook")
	var frame: Dictionary = player.net_input_state()
	frame.leftGrappleAction = "fire"
	player.record_prediction(2, frame)
	player.apply_server_snapshot({"lastAckedSeq": 1, "leftHook": {"active": false}}, 1.0 / 60.0)
	_check(player.odm.left_hook.active, "stale snapshot preserves an unacknowledged hook")
	Input.action_release("grapple_left")
	player.apply_server_snapshot({"lastAckedSeq": 2, "leftHook": {"active": false}}, 1.0 / 60.0)
	_check(not player.odm.left_hook.active, "an acknowledged rejection detaches the predicted hook")

	player.respawn(Vector3(0, 0.1, 0), PI)
	await _ticks(12)
	frame = player.net_input_state()
	player.record_prediction(10, frame)
	frame.moveForward = 1.0
	for i in range(11, 21):
		player.record_prediction(i, frame)
	player.apply_server_snapshot({
		"lastAckedSeq": 10, "position": [8.0, 0.05, 0.0],
		"velocity": [0.0, 0.0, 0.0], "grounded": true
	}, 1.0 / 60.0)
	await _ticks(2)
	_check(player.global_position.x > 7.0 and player.global_position.z < -0.5,
		"reconciliation replays unacknowledged movement after an authoritative correction")

	player.apply_server_snapshot({
		"lifeState": "downed", "health": 0, "position": [10, 0.1, 0], "grounded": true
	}, 1.0 / 60.0)
	await _ticks(2)
	_check(player.downed and not player.is_dead() and player.animation_state == &"HitReaction",
		"authoritative downed state is distinct from death")
	player.apply_server_snapshot({
		"lifeState": "alive", "health": 40, "position": [10, 0.1, 0], "grounded": true
	}, 1.0 / 60.0)
	await _ticks(15)
	_check(not player.downed and player.health == 40.0 and player.animation_state == &"Idle",
		"revive restores an actionable pose after settling onto the floor")


func _box(center: Vector3, size: Vector3, grappleable: bool) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = center
	body.collision_layer = 1
	body.set_meta("grappleable", grappleable)
	var collider := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collider.shape = shape
	body.add_child(collider)
	root.add_child(body)
	return body


func _ticks(count: int) -> void:
	for i in range(count):
		await physics_frame


func _check(condition: bool, description: String) -> void:
	if not condition:
		failures += 1
		push_error("Traversal: " + description)
