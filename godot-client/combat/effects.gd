class_name TitanFeedback
extends Node3D
## Pooled rendering and audio responses. Combat owns hit and projectile timing.

const Cues = preload("res://audio/cues.gd")
const PUFF_COUNT := 64
const ARC_COUNT := 8
const PARTICLE_SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, shadows_disabled;

void fragment() {
	ALBEDO = COLOR.rgb;
	ALPHA = COLOR.a;
}
"""

class Puff:
	var position := Vector3.ZERO
	var velocity := Vector3.ZERO
	var tint := Color.WHITE
	var age := 0.0
	var lifetime := 0.0
	var initial_size := 1.0
	var final_size := 1.0

class Arc:
	var visual: MeshInstance3D
	var material: StandardMaterial3D
	var age := 0.0
	var lifetime := 0.0
	var expands := false

var master_volume := 0.7:
	set(value):
		master_volume = clampf(value, 0.0, 1.0)
		_cues.master_volume = master_volume

var _cues := Cues.new()
var _random := RandomNumberGenerator.new()
var _puffs: Array[Puff] = []
var _arcs: Array[Arc] = []
var _next_puff := 0
var _next_arc := 0
var _particles := MultiMesh.new()
var _shaft := CylinderMesh.new()
var _flame := CylinderMesh.new()


func _ready() -> void:
	add_child(_cues)
	_cues.master_volume = master_volume
	_make_puff_pool()
	_make_arc_pool()

	_shaft.top_radius = 0.06
	_shaft.bottom_radius = 0.08
	_shaft.height = 1.4
	_shaft.radial_segments = 8
	_shaft.rings = 1
	_shaft.material = _unshaded(Color("#fbbf24"))
	_flame.top_radius = 0.0
	_flame.bottom_radius = 0.16
	_flame.height = 0.55
	_flame.radial_segments = 8
	_flame.rings = 1
	_flame.material = _unshaded(Color("#f97316"))

	set_process(false)


func play_cue(cue: String, at: Vector3 = Vector3.ZERO) -> void:
	_cues.play_cue(cue, at)


func gas_puff(at: Vector3, player_velocity: Vector3 = Vector3.ZERO) -> void:
	var drift := -player_velocity * 0.18 + _scatter(1.25, -0.6, 1.4)
	_emit_puff(at, drift, Color("#e0f2fe", 0.65), 0.36, 0.7, 2.6)


func burst(at: Vector3, style: String) -> void:
	match style:
		"gas":
			gas_puff(at)
		"exhaust":
			_emit_puff(at, _scatter(1.5, -1.5, 1.5), Color("#fb923c", 0.8), 0.22, 0.65, 1.8)
		"steam":
			_emit_steam(at)
		"explosion":
			_explosion(at)
		"critical", "impact", "glance":
			_impact(at, style)


func slash(feet: Vector3, yaw: float, heavy: bool) -> void:
	for i in (3 if heavy else 1):
		var tint := Color("#38bdf8", 0.92)
		if heavy:
			tint = Color("#fbbf24", 0.92) if i % 2 == 0 else Color("#f43f5e", 0.92)
		var tilt := Vector3(_random.randf_range(-0.225, 0.225) + i * 0.22,
			yaw + i * 2.1, 0.15 + i * 0.2 if heavy else -0.35)
		_emit_arc(feet + Vector3.UP * (1.0 + i * 0.25), tilt, tint, 0.36 if heavy else 0.20)


func make_projectile() -> Node3D:
	# Local +Z points toward the target, matching the original model.
	var projectile := Node3D.new()
	var shaft := MeshInstance3D.new()
	shaft.mesh = _shaft
	shaft.rotation.x = PI * 0.5
	shaft.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	projectile.add_child(shaft)
	var flame := MeshInstance3D.new()
	flame.mesh = _flame
	flame.rotation.x = -PI * 0.5
	flame.position.z = -0.85
	flame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	projectile.add_child(flame)
	return projectile


func clear_effects() -> void:
	for puff in _puffs:
		puff.lifetime = 0.0
	_particles.visible_instance_count = 0
	for arc in _arcs:
		arc.lifetime = 0.0
		arc.visual.hide()
	set_process(false)


func _process(delta: float) -> void:
	var visible_puffs := 0
	for puff in _puffs:
		if puff.age >= puff.lifetime:
			continue
		puff.age += delta
		if puff.age >= puff.lifetime:
			continue
		var progress := puff.age / puff.lifetime
		var size := lerpf(puff.initial_size, puff.final_size, progress)
		puff.position += puff.velocity * delta
		var transform_ := Transform3D(Basis.from_scale(Vector3.ONE * size), puff.position)
		var tint := Color(puff.tint, puff.tint.a * (1.0 - progress))
		_particles.set_instance_transform(visible_puffs, transform_)
		_particles.set_instance_color(visible_puffs, tint)
		visible_puffs += 1
	_particles.visible_instance_count = visible_puffs

	var visible_arcs := 0
	for arc in _arcs:
		if arc.age >= arc.lifetime:
			continue
		arc.age += delta
		if arc.age >= arc.lifetime:
			arc.visual.hide()
			continue
		var progress := arc.age / arc.lifetime
		arc.visual.rotation.y += delta * 16.0
		arc.visual.scale = Vector3.ONE * (1.0 + progress * (1.65 if arc.expands else 0.35))
		arc.material.albedo_color.a = (1.0 - progress) * 0.85
		visible_arcs += 1

	if visible_puffs == 0 and visible_arcs == 0:
		set_process(false)


func _make_puff_pool() -> void:
	var mesh := SphereMesh.new()
	mesh.radius = 0.22
	mesh.height = 0.44
	mesh.radial_segments = 8
	mesh.rings = 4

	var material := ShaderMaterial.new()
	material.shader = Shader.new()
	material.shader.code = PARTICLE_SHADER
	mesh.material = material

	_particles.transform_format = MultiMesh.TRANSFORM_3D
	_particles.use_colors = true
	_particles.mesh = mesh
	_particles.instance_count = PUFF_COUNT
	_particles.visible_instance_count = 0
	for i in PUFF_COUNT:
		_puffs.append(Puff.new())
	var visual := MultiMeshInstance3D.new()
	visual.multimesh = _particles
	visual.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(visual)


func _make_arc_pool() -> void:
	var ring := _make_arc_mesh()
	for i in ARC_COUNT:
		var arc := Arc.new()
		arc.material = _unshaded(Color("#38bdf8", 0.92), true)
		arc.visual = MeshInstance3D.new()
		arc.visual.mesh = ring
		arc.visual.material_override = arc.material
		arc.visual.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		arc.visual.hide()
		add_child(arc.visual)
		_arcs.append(arc)


func _make_arc_mesh() -> ArrayMesh:
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in 20:
		var theta := PI * 1.35 * i / 20.0
		var next := PI * 1.35 * (i + 1) / 20.0
		var a := Vector3(cos(theta), 0.0, -sin(theta))
		var b := Vector3(cos(next), 0.0, -sin(next))
		for vertex in [a * 1.1, a * 2.25, b * 2.25, a * 1.1, b * 2.25, b * 1.1]:
			surface.add_vertex(vertex)
	return surface.commit()


func _impact(at: Vector3, style: String) -> void:
	var critical := style == "critical"
	var tint := Color("#ef4444", 0.90) if critical else Color("#dc2626", 0.90)
	if style == "glance":
		tint = Color("#fde047", 0.90)
	for i in (18 if critical else 10):
		_emit_puff(at, _scatter(7.0, 2.0, 11.0), tint, 0.65 if critical else 0.42,
			1.3 if critical else 0.9, 0.2)
	if style != "glance":
		_emit_steam(at)


func _emit_steam(at: Vector3) -> void:
	for i in 6:
		_emit_puff(at, _scatter(2.0, 4.0, 9.0), Color("#f8fafc", 0.55), 0.85, 1.2, 4.2)


func _explosion(at: Vector3) -> void:
	var palette := [Color("#fef08a", 0.95), Color("#f97316", 0.95), Color("#ef4444", 0.95)]
	for i in 28:
		_emit_puff(at, _scatter(12.0, -4.0, 16.0), palette[i % 3],
			_random.randf_range(0.55, 0.80), 1.6, 4.2)
	for i in 2:
		var tilt := Vector3(i * 0.8, _random.randf_range(0, PI), i * -0.6)
		_emit_arc(at, tilt, Color("#fde047", 0.95), 0.38, true)


func _emit_puff(
	at: Vector3, drift: Vector3, tint: Color, lifetime: float, initial: float, final: float,
) -> void:
	var puff := _puffs[_next_puff]
	_next_puff = (_next_puff + 1) % PUFF_COUNT
	puff.position = to_local(at)
	puff.velocity = global_basis.inverse() * drift
	puff.tint = tint
	puff.age = 0.0
	puff.lifetime = lifetime
	puff.initial_size = initial
	puff.final_size = final
	set_process(true)


func _emit_arc(
	at: Vector3, tilt: Vector3, tint: Color, lifetime: float, expands := false,
) -> void:
	var arc := _arcs[_next_arc]
	_next_arc = (_next_arc + 1) % ARC_COUNT
	arc.age = 0.0
	arc.lifetime = lifetime
	arc.expands = expands
	arc.visual.global_position = at
	arc.visual.rotation = tilt
	arc.visual.scale = Vector3.ONE
	arc.material.albedo_color = tint
	arc.visual.show()
	set_process(true)


func _scatter(horizontal: float, minimum_y: float, maximum_y: float) -> Vector3:
	return Vector3(_random.randf_range(-horizontal, horizontal), _random.randf_range(minimum_y, maximum_y),
		_random.randf_range(-horizontal, horizontal))


func _unshaded(tint: Color, translucent := false) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color = tint
	if translucent:
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
	return material
