extends MeshInstance3D

const City := preload("res://world/city.gd")
const Player := preload("res://player/player.gd")

var _debug_mesh := ImmediateMesh.new()
var _debug_material := StandardMaterial3D.new()
var _debug_started := false

func _ready() -> void:
	mesh = _debug_mesh
	_debug_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_debug_material.vertex_color_use_as_albedo = true
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func refresh(settings: Dictionary, city: City, player: Player, actors: Array[TitanActor]) -> void:
	_debug_mesh.clear_surfaces()
	if not (settings.showColliders or settings.showTitanHitboxes or settings.showGrappleAnchors or settings.showVelocityVectors or settings.showWeakPoints):
		return
	_debug_started = false
	if settings.showColliders:
		for body in city.city_bodies:
			var collider := body.get_child(0) as CollisionShape3D
			var box := collider.shape as BoxShape3D
			if box != null:
				_debug_box(body.position, box.size * 0.5, Color("5ed8c5"))
	if settings.showTitanHitboxes or settings.showWeakPoints:
		for actor in actors:
			if actor.is_dead():
				continue
			for zone: String in actor.zones:
				if settings.showTitanHitboxes or zone == "Nape":
					_debug_box(actor.zone_position(zone), Vector3.ONE * float(actor.zones[zone].radius), Color("f47a68"))
	if settings.showGrappleAnchors:
		for hook in [player.odm.left_hook, player.odm.right_hook]:
			if hook.active:
				_debug_box(hook.anchor_position, Vector3.ONE * 0.4, Color("ffd793"))
	if settings.showVelocityVectors:
		_debug_line(player.global_position + Vector3.UP, player.global_position + Vector3.UP + player.velocity * 0.3, Color("e9bc80"))
	if _debug_started:
		_debug_mesh.surface_end()

func _debug_box(center: Vector3, extent: Vector3, tint: Color) -> void:
	for axis in [Vector3.RIGHT, Vector3.UP, Vector3.BACK]:
		var first: Vector3 = Vector3.UP if axis == Vector3.RIGHT else Vector3.RIGHT
		var second: Vector3 = axis.cross(first).abs()
		for a in [-1, 1]:
			for b in [-1, 1]:
				var edge: Vector3 = center + first * extent * a + second * extent * b
				_debug_line(edge - axis * extent, edge + axis * extent, tint)

func _debug_line(from: Vector3, to: Vector3, tint: Color) -> void:
	if not _debug_started:
		_debug_mesh.surface_begin(Mesh.PRIMITIVE_LINES, _debug_material)
		_debug_started = true
	_debug_mesh.surface_set_color(tint)
	_debug_mesh.surface_add_vertex(from)
	_debug_mesh.surface_set_color(tint)
	_debug_mesh.surface_add_vertex(to)
