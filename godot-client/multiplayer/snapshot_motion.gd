extends RefCounted
## Interpolate in the client receive-time domain to avoid wall-clock skew.

const MAX_EXTRAPOLATION_MS: int = 180


static func sample(samples: Array[Dictionary], render_ms: int) -> Dictionary:
	var first: Dictionary = samples.front()
	if render_ms <= int(first.recv_ms):
		return _pose(first.state)

	var previous := first
	for i in range(1, samples.size()):
		var current := samples[i]
		if render_ms <= int(current.recv_ms):
			var span := maxi(1, int(current.recv_ms) - int(previous.recv_ms))
			var alpha := float(render_ms - int(previous.recv_ms)) / span
			var start := _pose(previous.state)
			var end := _pose(current.state)
			return {
				"position": (start.position as Vector3).lerp(end.position, alpha),
				"velocity": (start.velocity as Vector3).lerp(end.velocity, alpha),
				"yaw": lerp_angle(start.yaw, end.yaw, alpha),
			}
		previous = current

	var latest := _pose(previous.state)
	var seconds := mini(MAX_EXTRAPOLATION_MS, render_ms - int(previous.recv_ms)) / 1000.0
	var extrapolated: Vector3 = latest.position + latest.velocity * seconds
	extrapolated.y = maxf(0.0, extrapolated.y)
	latest.position = extrapolated
	return latest


static func vector3(values: Array) -> Vector3:
	return Vector3(float(values[0]), float(values[1]), float(values[2]))


static func _pose(state: Dictionary) -> Dictionary:
	return {
		"position": vector3(state.position),
		"velocity": vector3(state.velocity),
		"yaw": float(state.yaw),
	}
