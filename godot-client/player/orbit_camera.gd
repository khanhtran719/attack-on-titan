extends Camera3D
## Third-person aim uses -Z; the imported player visual faces +Z.

const MIN_PITCH: float = -1.15
const MAX_PITCH: float = 1.25
const BASE_FOV: float = 62.0

var yaw: float = 0.0
var pitch: float = 0.14
var sensitivity: float = 1.0
var target_distance: float = 5.8
var _distance: float = 5.8
var _pivot := Vector3.ZERO
var _shake_intensity: float = 0.0
var _shake_timer: float = 0.0
var _wall_probe := SphereShape3D.new()
var _mouse_delta := Vector2.ZERO


func _ready() -> void:
	top_level = true
	near = 0.2
	far = 480.0
	fov = BASE_FOV
	_wall_probe.radius = 0.28


func reset_view(feet: Vector3, facing: float, start_pitch: float = 0.14) -> void:
	yaw = wrapf(facing - PI, -PI, PI)
	pitch = start_pitch
	_pivot = feet + Vector3.UP * 1.65
	_distance = target_distance
	_mouse_delta = Vector2.ZERO
	_shake_timer = 0.0
	_shake_intensity = 0.0
	fov = BASE_FOV
	_place_camera(0.0)


func add_mouse_delta(motion: Vector2) -> void:
	_mouse_delta += motion


func clear_mouse_delta() -> void:
	_mouse_delta = Vector2.ZERO


func add_shake(intensity: float, duration: float = 0.18) -> void:
	_shake_intensity = maxf(_shake_intensity, intensity)
	_shake_timer = maxf(_shake_timer, duration)


func forward() -> Vector3:
	return Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))


func flat_forward() -> Vector3:
	return Vector3(-sin(yaw), 0.0, -cos(yaw))


func right() -> Vector3:
	return Vector3(cos(yaw), 0.0, -sin(yaw))


func update_view(dt: float, feet: Vector3, velocity: Vector3, boosting: bool, target: Variant) -> void:
	var mouse_motion := _mouse_delta
	_mouse_delta = Vector2.ZERO
	yaw = wrapf(yaw - mouse_motion.x * 0.0022 * sensitivity, -PI, PI)
	pitch = clampf(pitch - mouse_motion.y * 0.0022 * sensitivity, MIN_PITCH, MAX_PITCH)

	if target is Vector3 and mouse_motion.length() < 4.0:
		var offset: Vector3 = target - _pivot
		var flat_length := Vector2(offset.x, offset.z).length()
		if flat_length > 1.5:
			yaw = lerp_angle(yaw, atan2(-offset.x, -offset.z), minf(1.0, dt * 3.8))
			var target_pitch := clampf(atan2(offset.y, flat_length) * 0.65, MIN_PITCH, MAX_PITCH)
			pitch = lerpf(pitch, target_pitch, _factor(3.5, dt))

	var ahead := velocity * 0.065
	ahead.y *= 0.35
	_pivot = _pivot.lerp(feet + Vector3.UP * 1.65 + ahead, _factor(16.0, dt))
	_place_camera(dt)

	var speed_ratio := clampf((velocity.length() - 9.0) / 36.0, 0.0, 1.0)
	var target_fov := minf(86.0, BASE_FOV + 24.0 * speed_ratio + (5.5 if boosting else 0.0))
	fov = lerpf(fov, target_fov, _factor(7.5, dt))


func _place_camera(dt: float) -> void:
	var side := right()
	var pivot_with_shoulder := _pivot + side * _clear_distance(_pivot, side, 0.55)
	var direction := forward()
	var allowed := _clear_distance(pivot_with_shoulder, -direction, target_distance)
	# Clamp inward immediately to prevent even a single frame behind a wall.
	_distance = minf(allowed, lerpf(_distance, allowed, _factor(9.0, dt)))
	var camera_position := pivot_with_shoulder - direction * _distance
	camera_position.y = maxf(0.55, camera_position.y)
	if _shake_timer > 0.0:
		_shake_timer = maxf(0.0, _shake_timer - dt)
		var amplitude := _shake_intensity * (_shake_timer / 0.2)
		camera_position += Vector3(randf_range(-1.0, 1.0), randf_range(-1.0, 1.0), randf_range(-1.0, 1.0)) * amplitude
		if _shake_timer <= 0.0:
			_shake_intensity = 0.0
	global_position = camera_position
	look_at(pivot_with_shoulder + direction * 18.0, Vector3.UP)


func _clear_distance(pivot: Vector3, direction: Vector3, distance: float) -> float:
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = _wall_probe
	query.transform = Transform3D(Basis.IDENTITY, pivot)
	query.motion = direction * distance
	query.collision_mask = 1
	var space := get_world_3d().direct_space_state
	var sweep := space.cast_motion(query)
	var safe_distance := distance * sweep[0] if sweep.size() >= 1 else distance
	# A ray also catches cases where the shoulder probe starts inside a wall.
	var ray := PhysicsRayQueryParameters3D.create(pivot, pivot + direction * distance, 1)
	ray.hit_from_inside = true
	var hit := space.intersect_ray(ray)
	if not hit.is_empty():
		safe_distance = minf(safe_distance, pivot.distance_to(hit.position) - 0.35)
	return maxf(0.0, safe_distance)


func _factor(rate: float, dt: float) -> float:
	return 1.0 - exp(-rate * dt)
