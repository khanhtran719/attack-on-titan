extends Node3D
## Acquires static and moving anchors, independently for the two winches.

signal hook_changed(side: String, active: bool)

const RopeSolver = preload("res://player/rope_solver.gd")
const MAX_RANGE: float = 88.0
const WORLD_LAYER: int = 1
const TITAN_LAYER: int = 4
const CHEST_HEIGHT: float = 1.35
const ASSIST_ANGLES := [
	Vector3(0.063, 0.035, 0), Vector3(0.112, 0, 0), Vector3(0, 0.070, 0),
	Vector3(0, -0.056, 0), Vector3(0.154, 0.063, 0), Vector3(-0.063, 0.035, 0),
	Vector3(0.189, -0.028, 0), Vector3(0, 0.133, 0), Vector3(0, -0.119, 0),
	Vector3(0.34, 0.14, 0), Vector3(0.34, -0.12, 0), Vector3(0.38, 0.28, 0),
	Vector3(-0.32, 0.14, 0), Vector3(0, 0.32, 0), Vector3(0, -0.28, 0),
	Vector3(0.48, 0.12, 1), Vector3(0.48, 0.26, 1), Vector3(0.58, 0.16, 1),
	Vector3(0.58, 0.32, 1), Vector3(0.68, 0.20, 1), Vector3(-0.46, 0.16, 1),
	Vector3(-0.56, 0.22, 1)
]

var left_hook := RopeSolver.Hook.new()
var right_hook := RopeSolver.Hook.new()
var last_left_reason: String = ""
var last_right_reason: String = ""
var _wires: Array[MeshInstance3D] = []
var _tips: Array[MeshInstance3D] = []
var _exclusions: Array[RID] = []


func _ready() -> void:
	var cylinder := CylinderMesh.new()
	cylinder.top_radius = 0.022
	cylinder.bottom_radius = 0.022
	cylinder.height = 1.0
	cylinder.radial_segments = 6
	cylinder.rings = 0
	var marker := SphereMesh.new()
	marker.radius = 0.18
	marker.height = 0.36
	marker.radial_segments = 6
	marker.rings = 3
	for color in [Color("#38d9c0"), Color("#f5a623")]:
		_wires.append(_mesh(cylinder, Color("#dbeafe")))
		_tips.append(_mesh(marker, color))


func exclude_body(body: CollisionObject3D) -> void:
	_exclusions = [body.get_rid()]


func any_active() -> bool:
	return left_hook.active or right_hook.active


func release_all() -> void:
	release("left")
	release("right")


func release(side: String) -> void:
	var hook := _get_hook(side)
	if not hook.active:
		return
	hook.active = false
	hook.taut = false
	hook.follows_target = false
	hook.target = null
	hook.attached_titan_id = ""
	hook.attached_zone = ""
	hook_changed.emit(side, false)


func reset() -> void:
	release_all()
	left_hook.retry_time = 0.0
	right_hook.retry_time = 0.0
	last_left_reason = ""
	last_right_reason = ""
	for mesh in _wires + _tips:
		mesh.hide()


func update_held(
	side: String, held: bool, pressed: bool, gas: float,
	feet: Vector3, camera_origin: Vector3, aim: Vector3, locked: Node3D, dt: float
) -> bool:
	var hook := _get_hook(side)
	hook.retry_time = maxf(0.0, hook.retry_time - dt)
	if not held and not pressed:
		hook.retry_time = 0.0
		release(side)
		return false
	if gas <= 1.0 or (not pressed and (hook.active or hook.retry_time > 0.0)):
		return false
	hook.retry_time = 0.12
	var hit := probe(feet, camera_origin, aim, -1 if side == "left" else 1, locked)
	var reason: String = hit.get("reason", "REJECT_NO_SURFACE_IN_CONE")
	if side == "left":
		last_left_reason = reason
	else:
		last_right_reason = reason
	if hit.is_empty():
		return false

	var was_active := hook.active
	hook.active = true
	hook.anchor_position = hit.point
	hook.rest_length = maxf(RopeSolver.MIN_LENGTH, feet.distance_to(hook.anchor_position))
	hook.deploy_progress = 0.25
	hook.target = hit.get("target") as Node3D
	hook.follows_target = is_instance_valid(hook.target)
	hook.attached_titan_id = ""
	hook.attached_zone = ""
	if hook.follows_target:
		hook.target_local_offset = hook.target.to_local(hook.anchor_position)
		hook.attached_titan_id = str(hook.target.get_meta("titan_id", ""))
		hook.attached_zone = str(hook.target.get_meta("zone", ""))
	if not was_active:
		hook_changed.emit(side, true)
	return true


func refresh_anchors(feet: Vector3, dt: float) -> Array[RopeSolver.Hook]:
	var active_hooks: Array[RopeSolver.Hook] = []
	for side in ["left", "right"]:
		var hook := _get_hook(side)
		if not hook.active:
			continue
		if hook.follows_target:
			if not _target_alive(hook.target):
				release(side)
				continue
			hook.anchor_position = hook.target.to_global(hook.target_local_offset)
		if feet.distance_to(hook.anchor_position) > MAX_RANGE * 1.22:
			release(side)
			continue
		hook.deploy_progress = minf(1.0, hook.deploy_progress + dt * 9.5)
		active_hooks.append(hook)
	return active_hooks


func sync_hook_from_server(side: String, net: Dictionary, marker: Node3D = null) -> void:
	var hook := _get_hook(side)
	if not bool(net.get("active", false)):
		release(side)
		return
	var anchor: Variant = net.get("anchor", [])
	if not anchor is Array or anchor.size() != 3:
		return
	var was_active := hook.active
	hook.active = true
	hook.anchor_position = Vector3(float(anchor[0]), float(anchor[1]), float(anchor[2]))
	hook.taut = bool(net.get("isTaut", false))
	var server_length := maxf(RopeSolver.MIN_LENGTH, float(net.get("restLength", 2.2)))
	if not was_active:
		hook.deploy_progress = 1.0
		hook.rest_length = server_length
	elif absf(hook.rest_length - server_length) > 0.6:
		hook.rest_length = lerpf(hook.rest_length, server_length, 0.6)
	hook.target = marker
	hook.follows_target = _target_alive(marker)
	hook.target_local_offset = Vector3.ZERO
	hook.attached_titan_id = _nullable_string(net.get("attachedTitanId"))
	hook.attached_zone = _nullable_string(net.get("attachedZone"))
	if not was_active:
		hook_changed.emit(side, true)


func probe(feet: Vector3, origin: Vector3, aim: Vector3, side_sign: int = 0, locked: Node3D = null) -> Dictionary:
	var forward := aim.normalized()
	if forward.is_zero_approx():
		return {}
	var chest := feet + Vector3.UP * CHEST_HEIGHT
	if _target_alive(locked):
		var point := locked.global_position
		if feet.distance_to(point) <= MAX_RANGE and (point - origin).normalized().dot(forward) > 0.35:
			if _ray(chest, point, WORLD_LAYER).is_empty():
				return _target_hit(point, locked, "LOCKED_TITAN_LATCH")

	var titan := _find_titan(feet, chest, origin, forward)
	if not titan.is_empty():
		return titan
	return _find_world(feet, chest, origin, forward, side_sign)


func _find_titan(feet: Vector3, chest: Vector3, origin: Vector3, forward: Vector3) -> Dictionary:
	var best: Dictionary = {}
	var best_score: float = INF
	for node in get_tree().get_nodes_in_group("grapple_zone"):
		var marker := node as Node3D
		if not _target_alive(marker):
			continue
		var point := marker.global_position
		var distance := feet.distance_to(point)
		var offset := point - origin
		var projection := offset.dot(forward)
		var radius := float(marker.get_meta("grapple_radius", 0.6))
		if distance > MAX_RANGE or projection <= 0.0:
			continue
		var perpendicular := (offset - forward * projection).length()
		var score := perpendicular * 3.0 + distance * 0.1
		if perpendicular <= radius * 2.4 and score < best_score:
			if _ray(chest, point, WORLD_LAYER).is_empty() and _ray(origin, point, WORLD_LAYER).is_empty():
				best_score = score
				best = _target_hit(point, marker, "RAY_TITAN_LATCH")
	if not best.is_empty():
		return best

	var hit := _ray(origin, origin + forward * (MAX_RANGE + 8.0), WORLD_LAYER | TITAN_LAYER, true)
	var collider := hit.get("collider") as Node3D
	if not _target_alive(collider) or not collider is CollisionObject3D:
		return {}
	if not (collider.collision_layer & TITAN_LAYER):
		return {}
	var point: Vector3 = hit.position
	if feet.distance_to(point) > MAX_RANGE or not _ray(chest, point, WORLD_LAYER).is_empty():
		return {}
	return _target_hit(point, collider, "RAY_TITAN_LATCH")


func _find_world(feet: Vector3, chest: Vector3, origin: Vector3, forward: Vector3, side_sign: int) -> Dictionary:
	var right := forward.cross(Vector3.UP).normalized()
	if right.length_squared() < 0.001:
		right = Vector3.RIGHT
	var ortho_up := right.cross(forward).normalized()
	var biased := (forward + right * (0.04 * side_sign)).normalized()
	var direct := _world_ray(origin, biased, MAX_RANGE + 10.0)
	if _world_in_range(direct, origin, feet, 1.2):
		var point: Vector3 = direct.position
		if point.y < feet.y + 4.5:
			for lift in [0.18, 0.30, 0.42]:
				var elevated := _world_ray(origin, (biased + ortho_up * lift).normalized(), MAX_RANGE + 10.0)
				if _world_in_range(elevated, origin, feet, point.y + 2.5):
					var candidate: Vector3 = elevated.position
					var lateral := Vector2(candidate.x - point.x, candidate.z - point.z)
					if lateral.length() <= 6.0:
						point = candidate
						break
		var visible_hit := _visible_world_point(chest, point, feet)
		if not visible_hit.is_empty():
			return {"point": visible_hit.position, "reason": "DIRECT_WORLD_LATCH"}

	var chest_direction := (origin + biased * 65.0 - chest).normalized()
	var chest_hit := _world_ray(chest, chest_direction, MAX_RANGE)
	if _world_in_range(chest_hit, chest, feet, 1.5):
		return {"point": chest_hit.position, "reason": "DIRECT_WORLD_LATCH"}

	var best: Dictionary = {}
	var best_score: float = -INF
	var preference: int = side_sign if side_sign != 0 else 1
	for angle: Vector3 in ASSIST_ANGLES:
		var corridor := angle.z > 0.0
		if corridor and absf(forward.y) >= 0.7:
			continue
		var direction := (biased + right * angle.x * preference + ortho_up * angle.y).normalized()
		var hit := _world_ray(origin, direction, MAX_RANGE + 8.0)
		if not _world_in_range(hit, origin, feet, 1.5):
			continue
		var visible_hit := _visible_world_point(chest, hit.position, feet)
		if visible_hit.is_empty():
			continue
		var point: Vector3 = visible_hit.position
		var distance := point.distance_to(feet)
		if distance < 2.5 or point.y < 1.5:
			continue
		var to_point := (point - origin).normalized()
		var alignment := to_point.dot(forward)
		if alignment < 0.35:
			continue
		var side_bonus := 0.0
		if side_sign != 0:
			side_bonus = 0.18 if to_point.dot(right) * side_sign >= -0.02 else -0.12
		var distance_bonus := 0.15 if distance >= 12.0 and distance <= 72.0 else 0.05 - absf(distance - 42.0) * 0.002
		var score := alignment * 2.2 + side_bonus + clampf((point.y - feet.y) / 18.0, -0.1, 0.32) + distance_bonus
		if score > best_score:
			best_score = score
			best = {"point": point, "reason": "CORRIDOR_ASSIST_WORLD_LATCH" if corridor else "ASSIST_CONE_WORLD_LATCH"}
	return best


func _visible_world_point(chest: Vector3, point: Vector3, feet: Vector3) -> Dictionary:
	var offset := point - chest
	if offset.length() < 0.5 or offset.length() > MAX_RANGE + 4.0:
		return {}
	var hit := _world_ray(chest, offset.normalized(), offset.length() + 0.15)
	if hit.is_empty() or feet.distance_to(hit.position) > MAX_RANGE or hit.position.y < 1.2:
		return {}
	return hit


func _world_ray(origin: Vector3, direction: Vector3, distance: float) -> Dictionary:
	var hit := _ray(origin, origin + direction * distance, WORLD_LAYER)
	var collider := hit.get("collider") as Node
	if collider == null or not bool(collider.get_meta("grappleable", false)):
		return {}
	return hit


func _ray(from: Vector3, to: Vector3, mask: int, areas: bool = false) -> Dictionary:
	var query := PhysicsRayQueryParameters3D.create(from, to, mask, _exclusions)
	query.collide_with_areas = areas
	query.hit_from_inside = true
	return get_world_3d().direct_space_state.intersect_ray(query)


func _world_in_range(hit: Dictionary, origin: Vector3, feet: Vector3, minimum_height: float) -> bool:
	if hit.is_empty():
		return false
	var point: Vector3 = hit.position
	var distance := point.distance_to(feet)
	return point.y >= minimum_height and distance >= 2.5 and distance <= MAX_RANGE and point.distance_to(origin) >= 2.0


func _target_hit(point: Vector3, target: Node3D, reason: String) -> Dictionary:
	return {"point": point, "target": target, "reason": reason}


func _target_alive(node: Node3D) -> bool:
	if not is_instance_valid(node) or not node.is_inside_tree() or node.is_queued_for_deletion():
		return false
	if node.has_meta("zone") and not node.is_in_group("grapple_zone"):
		return false
	return bool(node.get_meta("grapple_active", true))


func _get_hook(side: String) -> RopeSolver.Hook:
	return left_hook if side == "left" else right_hook


func _nullable_string(value: Variant) -> String:
	return "" if value == null else str(value)


func update_visuals(left_winch: Vector3, right_winch: Vector3) -> void:
	_draw_hook(0, left_hook, left_winch)
	_draw_hook(1, right_hook, right_winch)


func _draw_hook(index: int, hook: RopeSolver.Hook, winch: Vector3) -> void:
	var wire := _wires[index]
	var tip := _tips[index]
	wire.visible = hook.active
	tip.visible = hook.active
	if not hook.active:
		return
	var end := winch.lerp(hook.anchor_position, hook.deploy_progress)
	var direction := end - winch
	var length := direction.length()
	if length < 0.001:
		wire.hide()
		return
	var wire_up := direction / length
	var perpendicular := Vector3.FORWARD if absf(wire_up.dot(Vector3.UP)) > 0.98 else Vector3.UP
	var wire_right := wire_up.cross(perpendicular).normalized()
	var wire_depth := wire_right.cross(wire_up).normalized()
	wire.global_transform = Transform3D(
		Basis(wire_right, wire_up * length, wire_depth), winch.lerp(end, 0.5)
	)
	tip.global_position = end


func _mesh(geometry: Mesh, color: Color) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color = color
	mesh.mesh = geometry
	mesh.material_override = material
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mesh.visible = false
	add_child(mesh)
	mesh.top_level = true
	return mesh
