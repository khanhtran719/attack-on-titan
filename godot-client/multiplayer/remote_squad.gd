extends Node3D
## Visual replicas of connected teammates from the authoritative snapshots.

signal exhaust_emitted(at: Vector3, velocity: Vector3)

const Pose = preload("res://player/player_pose.gd")
const AnimationStates = preload("res://player/player_animation.gd")
const Motion = preload("res://multiplayer/snapshot_motion.gd")
const INTERPOLATION_DELAY_MS: int = 85
const MAX_SAMPLES: int = 20
const VANGUARD_PATH: String = "res://assets/vanguard.glb"

var _avatars: Dictionary = {}


func sync_players(players: Dictionary, local_player_id: String) -> void:
	var recv_ms := Time.get_ticks_msec()
	for id: String in players:
		var state: Dictionary = players[id]
		if id == local_player_id or not bool(state.get("connected", false)):
			continue
		var avatar := _avatars.get(id) as RemoteAvatar
		if avatar == null:
			avatar = RemoteAvatar.new()
			_avatars[id] = avatar
			avatar.exhaust_emitted.connect(exhaust_emitted.emit)
			add_child(avatar)
		avatar.record(state, recv_ms)
	for id: String in _avatars.keys():
		if id == local_player_id or not bool(players.get(id, {}).get("connected", false)):
			_remove_avatar(id)


func clear() -> void:
	for id: String in _avatars.keys():
		_remove_avatar(id)


func _remove_avatar(id: String) -> void:
	var avatar := _avatars[id] as RemoteAvatar
	_avatars.erase(id)
	remove_child(avatar)
	avatar.queue_free()


class RemoteAvatar extends Node3D:
	signal exhaust_emitted(at: Vector3, velocity: Vector3)

	var _samples: Array[Dictionary] = []
	var _animator: AnimationPlayer
	var _pose: Pose
	var _left_winch: Node3D
	var _right_winch: Node3D
	var _nozzle: Node3D
	var _gas_elapsed: float = 0.0
	var _nameplate: Label3D
	var _wires: Array[MeshInstance3D] = []
	var _anchors: Array[MeshInstance3D] = []


	func _ready() -> void:
		if ResourceLoader.exists(VANGUARD_PATH):
			var rig := load(VANGUARD_PATH) as PackedScene
			if rig != null:
				var model := rig.instantiate() as Node3D
				add_child(model)
				_setup_rig(model)
		_nameplate = Label3D.new()
		_nameplate.position.y = 2.1
		_nameplate.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		_nameplate.pixel_size = 0.004
		_nameplate.font_size = 28
		_nameplate.outline_size = 8
		add_child(_nameplate)
		_create_hook_visuals()


	func record(state: Dictionary, recv_ms: int) -> void:
		if _samples.is_empty():
			global_position = Motion.vector3(state.position)
			rotation.y = float(state.yaw)
		_samples.append({"recv_ms": recv_ms, "state": state})
		if _samples.size() > MAX_SAMPLES:
			_samples.pop_front()


	func _process(delta: float) -> void:
		if _samples.is_empty():
			return
		var pose := Motion.sample(_samples, Time.get_ticks_msec() - INTERPOLATION_DELAY_MS)
		global_position = pose.position
		rotation.y = pose.yaw

		var latest: Dictionary = _samples.back().state
		var life_state := str(latest.get("lifeState", "alive"))
		_nameplate.text = str(latest.get("nickname", "Scout"))
		_nameplate.modulate = Color.hex((int(latest.get("colorHex", 0xffffff)) << 8) | 255).lightened(0.42)
		if life_state != "alive":
			_nameplate.text += " · %s" % life_state.capitalize()
			_nameplate.modulate = Color.SALMON
		var left: Dictionary = latest.get("leftHook", {})
		var right: Dictionary = latest.get("rightHook", {})
		_play_animation(str(latest.get("anim", "Idle")))
		_update_pose(latest, pose.velocity, left, right)
		_update_wire(0, left, _left_winch)
		_update_wire(1, right, _right_winch)
		if _nozzle != null:
			var boosting := bool(latest.get("isBoosting", false))
			if boosting or bool(left.get("active", false)) or bool(right.get("active", false)):
				_gas_elapsed += delta
				var interval := 0.035 if boosting else 0.08
				if _gas_elapsed >= interval:
					_gas_elapsed = fmod(_gas_elapsed, interval)
					exhaust_emitted.emit(_nozzle.global_position, pose.velocity)


	func _setup_rig(model: Node3D) -> void:
		var animators := model.find_children("*", "AnimationPlayer", true, false)
		if not animators.is_empty():
			_animator = animators.front() as AnimationPlayer
			for clip: StringName in _animator.get_animation_list():
				var animation := _animator.get_animation(clip)
				animation.loop_mode = Animation.LOOP_NONE if clip in AnimationStates.ONE_SHOTS else Animation.LOOP_LINEAR
		var skeletons := model.find_children("*", "Skeleton3D", true, false)
		if not skeletons.is_empty():
			_pose = Pose.new()
			skeletons[0].add_child(_pose)
		_left_winch = model.find_child("LeftWinch", true, false) as Node3D
		_right_winch = model.find_child("RightWinch", true, false) as Node3D
		_nozzle = model.find_child("ThrusterNozzle", true, false) as Node3D


	func _update_pose(state: Dictionary, speed: Vector3, left: Dictionary, right: Dictionary) -> void:
		if _pose == null:
			return
		_pose.yaw = rotation.y
		_pose.feet = global_position
		_pose.grounded = bool(state.get("grounded", false))
		_pose.animation = StringName(state.get("anim", "Idle"))
		_pose.speed = Vector2(speed.x, speed.z).length()
		_pose.vertical_speed = speed.y
		_pose.left_anchor = Motion.vector3(left.anchor) if bool(left.get("active", false)) else null
		_pose.right_anchor = Motion.vector3(right.anchor) if bool(right.get("active", false)) else null


	func _play_animation(clip: String) -> void:
		if _animator == null:
			return
		if _animator.assigned_animation != clip and _animator.has_animation(clip):
			_animator.play(clip, 0.14)


	func _create_hook_visuals() -> void:
		var cable := CylinderMesh.new()
		cable.top_radius = 0.022
		cable.bottom_radius = 0.022
		cable.height = 1.0
		cable.radial_segments = 6
		var marker := SphereMesh.new()
		marker.radius = 0.12
		marker.height = 0.24
		marker.radial_segments = 6
		marker.rings = 3
		for side: String in ["Left", "Right"]:
			_wires.append(_make_visual(side + "Cable", cable, Color("#bae6fd")))
			var tint := Color("#38d9c0") if side == "Left" else Color("#f5a623")
			_anchors.append(_make_visual(side + "Anchor", marker, tint))


	func _make_visual(node_name: String, mesh: Mesh, color: Color) -> MeshInstance3D:
		var visual := MeshInstance3D.new()
		visual.name = node_name
		var material := StandardMaterial3D.new()
		material.albedo_color = color
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		visual.mesh = mesh
		visual.material_override = material
		visual.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		visual.top_level = true
		visual.hide()
		add_child(visual)
		return visual


	func _update_wire(index: int, hook: Dictionary, winch: Node3D) -> void:
		var wire := _wires[index]
		var marker := _anchors[index]
		var active := bool(hook.get("active", false))
		wire.visible = active
		marker.visible = active
		if not active:
			return
		var hip := -0.31 if index == 0 else 0.31
		var origin := winch.global_position if winch != null else to_global(Vector3(hip, 0.98, 0.04))
		var anchor := Motion.vector3(hook.anchor)
		var segment := anchor - origin
		var length := segment.length()
		marker.global_position = anchor
		wire.visible = length > 0.001
		if wire.visible:
			var rotation_basis := Basis(Quaternion(Vector3.UP, segment / length))
			var sized_basis := rotation_basis * Basis.from_scale(Vector3(1, length, 1))
			wire.global_transform = Transform3D(sized_basis, origin.lerp(anchor, 0.5))
