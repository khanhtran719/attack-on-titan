extends Node
## Procedurally recreates the original Web Audio cues as cached PCM clips.

const SAMPLE_RATE := 24000
const VOICE_COUNT := 8
const SPATIAL_CUES := ["titan_step", "titan_roar", "impact", "critical", "glance", "explosion"]

var master_volume := 0.7:
	set(value):
		master_volume = clampf(value, 0.0, 1.0)
		_apply_volume()

var _clips: Dictionary[String, AudioStreamWAV] = {}
var _local_voices: Array[AudioStreamPlayer] = []
var _next_local_voice := 0
var _world_voices: Array[AudioStreamPlayer3D] = []
var _next_world_voice := 0
var _last_gas_time := -1000


func _ready() -> void:
	for i in VOICE_COUNT:
		var local_voice := AudioStreamPlayer.new()
		add_child(local_voice)
		_local_voices.append(local_voice)
		var voice := AudioStreamPlayer3D.new()
		voice.attenuation_model = AudioStreamPlayer3D.ATTENUATION_DISABLED
		add_child(voice)
		_world_voices.append(voice)
	_apply_volume()


func play_cue(cue: String, at: Vector3 = Vector3.ZERO) -> void:
	if cue == "gas":
		var now := Time.get_ticks_msec()
		if now - _last_gas_time < 120:
			return
		_last_gas_time = now

	var distance_gain := 1.0
	if cue == "titan_step":
		var camera := get_viewport().get_camera_3d()
		if camera != null:
			var distance := camera.global_position.distance_to(at)
			if distance > 85.0:
				return
			distance_gain = maxf(0.03 / 0.28, 1.0 - distance / 85.0)

	var clip := stream_for(cue)
	if clip == null:
		return
	if cue in SPATIAL_CUES and not at.is_equal_approx(Vector3.ZERO):
		var voice := _world_voices[_next_world_voice]
		_next_world_voice = (_next_world_voice + 1) % _world_voices.size()
		voice.stop()
		voice.stream = clip
		voice.global_position = at
		voice.volume_db = _master_db() + linear_to_db(distance_gain)
		voice.play()
	else:
		var voice := _local_voices[_next_local_voice]
		_next_local_voice = (_next_local_voice + 1) % _local_voices.size()
		voice.stop()
		voice.stream = clip
		voice.volume_db = _master_db() + linear_to_db(distance_gain)
		voice.play()


func stream_for(cue: String) -> AudioStreamWAV:
	if _clips.has(cue):
		return _clips[cue]

	var samples := PackedFloat32Array()
	match cue:
		"hook_left", "hook_right":
			var start := 420.0 if cue == "hook_left" else 460.0
			_tone(samples, "saw", [Vector2(0, start), Vector2(0.09, 1180), Vector2(0.16, 640)], 0.18, 0.17, 0.18)
		"hook_latch":
			_tone(samples, "triangle", _sweep(980, 220, 0.08), 0.24, 0.09, 0.10)
		"gas":
			_gas(samples)
		"light_slash":
			_tone(samples, "sine", _sweep(820, 160, 0.15), 0.28, 0.16, 0.26)
		"heavy_slash":
			_tone(samples, "sine", _sweep(680, 160, 0.24), 0.28, 0.25, 0.26)
		"impact":
			_tone(samples, "triangle", _sweep(240, 70, 0.18), 0.30, 0.19, 0.35)
		"critical":
			_tone(samples, "saw", _sweep(190, 55, 0.32), 0.42, 0.34, 0.35)
			_tone(samples, "triangle", _sweep(1480, 880, 0.28), 0.22, 0.29, 0.30)
		"glance":
			_tone(samples, "square", _sweep(1320, 520, 0.12), 0.16, 0.13, 0.35)
		"titan_step":
			_tone(samples, "sine", _sweep(78, 28, 0.22), 0.28, 0.24, 0.25)
		"titan_roar":
			_tone(samples, "saw", [Vector2(0, 115), Vector2(0.20, 145), Vector2(0.75, 62)], 0.24, 0.78, 0.80, 0, true)
		"resupply":
			var chord := [523.25, 659.25, 783.99, 1046.5]
			for i in chord.size():
				_tone(samples, "triangle", [Vector2(0, chord[i])], 0.18, 0.18, 0.20, i * 0.055)
		"spear_launch":
			_tone(samples, "saw", _sweep(280, 920, 0.14), 0.30, 0.22, 0.23)
		"explosion":
			_tone(samples, "saw", _sweep(140, 28, 0.48), 0.48, 0.50, 0.52)
		"grab_escape":
			_tone(samples, "triangle", _sweep(620, 1420, 0.18), 0.34, 0.20, 0.21)
		_:
			return null

	var pcm := PackedByteArray()
	pcm.resize(samples.size() * 2)
	for i in samples.size():
		pcm.encode_s16(i * 2, roundi(clampf(samples[i], -1.0, 1.0) * 32767.0))

	var clip := AudioStreamWAV.new()
	clip.format = AudioStreamWAV.FORMAT_16_BITS
	clip.mix_rate = SAMPLE_RATE
	clip.data = pcm
	_clips[cue] = clip
	return clip


func _apply_volume() -> void:
	var db := _master_db()
	for voice in _local_voices:
		voice.volume_db = db
	for voice in _world_voices:
		voice.volume_db = db


func _master_db() -> float:
	return linear_to_db(master_volume) if master_volume > 0.0 else -80.0


func _sweep(start: float, end: float, time: float) -> Array[Vector2]:
	return [Vector2(0, start), Vector2(time, end)]


func _tone(
	samples: PackedFloat32Array, shape: String, keys: Array[Vector2], gain: float,
	fade: float, duration: float, delay: float = 0.0, linear_first: bool = false,
) -> void:
	var start := roundi(delay * SAMPLE_RATE)
	var count := roundi(duration * SAMPLE_RATE)
	if samples.size() < start + count:
		samples.resize(start + count)
	var phase := 0.0
	var segment := 0
	for i in count:
		var time := float(i) / SAMPLE_RATE
		while segment + 1 < keys.size() and time >= keys[segment + 1].x:
			segment += 1
		var frequency := keys[segment].y
		if segment + 1 < keys.size():
			var next := keys[segment + 1]
			var ratio := inverse_lerp(keys[segment].x, next.x, time)
			if linear_first and segment == 0:
				frequency = lerpf(frequency, next.y, ratio)
			else:
				frequency *= pow(next.y / frequency, ratio)
		var envelope := gain * pow(0.001 / gain, minf(time / fade, 1.0))
		envelope *= minf(1.0, minf(time / 0.002, (duration - time) / 0.002))
		samples[start + i] += _wave(shape, phase) * maxf(envelope, 0.0)
		phase = fposmod(phase + frequency / SAMPLE_RATE, 1.0)


func _wave(shape: String, phase: float) -> float:
	match shape:
		"saw":
			return 2.0 * fposmod(phase + 0.5, 1.0) - 1.0
		"triangle":
			return 4.0 * absf(phase - floor(phase + 0.5)) - 1.0
		"square":
			return 1.0 if phase < 0.5 else -1.0
		_:
			return sin(TAU * phase)


func _gas(samples: PackedFloat32Array) -> void:
	var count := roundi(0.18 * SAMPLE_RATE)
	samples.resize(count)
	var rng := RandomNumberGenerator.new()
	rng.seed = 64473
	var omega := TAU * 1400.0 / SAMPLE_RATE
	var alpha := sin(omega) / (2.0 * 1.4)
	var b0 := alpha / (1.0 + alpha)
	var a1 := -2.0 * cos(omega) / (1.0 + alpha)
	var a2 := (1.0 - alpha) / (1.0 + alpha)
	var previous_input := 0.0
	var earlier_input := 0.0
	var previous_output := 0.0
	var earlier_output := 0.0
	for i in count:
		var progress := float(i) / count
		var noise := rng.randf_range(-1.0, 1.0) * exp(-progress / 0.65)
		var filtered := b0 * (noise - earlier_input) - a1 * previous_output - a2 * earlier_output
		samples[i] = filtered * 0.14 * pow(0.005 / 0.14, progress)
		earlier_input = previous_input
		previous_input = noise
		earlier_output = previous_output
		previous_output = filtered
