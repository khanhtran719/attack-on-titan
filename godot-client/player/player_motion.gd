extends RefCounted
## Shared numeric integration for live traversal and acknowledged input replay.

const RopeSolver = preload("res://player/rope_solver.gd")
const GRAVITY: float = -22.0


static func integrate(
	origin: Vector3, velocity: Vector3, on_floor: bool, steer: Vector3, aim: Vector3,
	boosting: bool, dodging: bool, hooks: Array[RopeSolver.Hook], dt: float
) -> RopeSolver.Result:
	var airborne := not on_floor or not hooks.is_empty()
	if boosting and airborne:
		var direction := aim
		if steer.length_squared() > 0.05:
			direction = direction.lerp(steer, 0.35).normalized()
		if direction.y < 0.08 and origin.y < 5.0:
			direction.y = 0.15
			direction = direction.normalized()
		velocity += direction * (38.0 * dt)

	var result := RopeSolver.Result.new()
	if not hooks.is_empty():
		velocity.y += GRAVITY * 0.72 * dt
		result = RopeSolver.solve(origin, velocity, hooks, steer, boosting, dt)
		velocity = result.velocity * (1.0 - 0.016 * dt * 12.0)
	elif airborne:
		velocity.y += GRAVITY * dt
		if steer.length_squared() > 0.01:
			velocity += steer * (18.0 * dt)
		velocity *= 1.0 - 0.016 * dt * 15.0
	else:
		if not dodging:
			var desired := steer * (13.5 if boosting else 9.5)
			velocity.x = lerpf(velocity.x, desired.x, minf(1.0, 11.0 * dt))
			velocity.z = lerpf(velocity.z, desired.z, minf(1.0, 11.0 * dt))
		velocity.y = minf(-1.5, velocity.y)
	result.velocity = velocity.limit_length(54.0)
	return result
