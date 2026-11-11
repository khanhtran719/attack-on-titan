extends RefCounted
## Fixed-tick port of solveODMRopeConstraints in src/utils/MathUtils.ts.

const MIN_LENGTH: float = 2.2
const MAX_AIR_SPEED: float = 50.0


class Hook:
	var active: bool = false
	var anchor_position := Vector3.ZERO
	var rest_length: float = 0.0
	var taut: bool = false
	var deploy_progress: float = 0.0
	var target: Node3D
	var target_local_offset := Vector3.ZERO
	var follows_target: bool = false
	var attached_titan_id: String = ""
	var attached_zone: String = ""
	var retry_time: float = 0.0


class Result:
	var correction := Vector3.ZERO
	var velocity := Vector3.ZERO


static func solve(
	origin: Vector3, initial_velocity: Vector3, hooks: Array[Hook],
	steer: Vector3, boost: bool, dt: float
) -> Result:
	var result := Result.new()
	result.velocity = initial_velocity
	if hooks.is_empty() or dt <= 0.0:
		return result

	var pull_sum := Vector3.ZERO
	var contributing_hooks: int = 0
	var reel_rate: float = 33.0 if boost else 19.0
	for hook in hooks:
		var offset := origin - hook.anchor_position
		var distance := offset.length()
		hook.rest_length = maxf(MIN_LENGTH, minf(hook.rest_length, distance + 0.5) - reel_rate * dt)
		var stretch := distance - hook.rest_length
		hook.taut = stretch > 0.0
		if distance < 0.001:
			continue

		var radial_out := offset / distance
		var pull := -radial_out
		pull_sum += pull
		contributing_hooks += 1
		if hook.taut:
			var radial_speed := initial_velocity.dot(radial_out)
			if radial_speed > 0.0:
				result.velocity -= radial_out * (radial_speed / hooks.size())
				var tangent := initial_velocity - radial_out * radial_speed
				if tangent.length_squared() > 0.01:
					result.velocity += tangent.normalized() * (radial_speed * 0.22 / hooks.size())
			var tension := minf(36.0 if boost else 24.0, stretch * 42.0 * dt + reel_rate * 0.65)
			result.velocity += pull * tension
			if stretch > 1.2:
				result.correction += pull * minf(stretch - 1.2, 6.0 * dt)
		elif distance > MIN_LENGTH:
			var gentle := reel_rate * (1.15 if boost else 0.75) * dt
			result.velocity += pull * (gentle * 14.0)

	if contributing_hooks > 0:
		var composite_pull := pull_sum.normalized()
		if steer.length_squared() > 0.001:
			var tangent_steer := steer - composite_pull * steer.dot(composite_pull)
			if tangent_steer.length_squared() > 0.001:
				result.velocity += tangent_steer.normalized() * (26.0 * dt)
			result.velocity += steer * (26.0 * 0.35 * dt)
		if contributing_hooks >= 2:
			result.velocity += composite_pull * ((24.0 if boost else 12.0) * dt)

	result.velocity = result.velocity.limit_length(MAX_AIR_SPEED)
	return result
