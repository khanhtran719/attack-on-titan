class_name ValkenburgCity
extends Node3D

const DetailedDistrict := preload("res://world/detailed_district.gd")
const GameData := preload("res://resources/game_data.gd")
const TRAINING_RINGS := [Vector3(0, 12, -25), Vector3(0, 15, -52), Vector3(14, 16, -78)]

var spawn_points: Array[Vector3] = []
var supply_points: Array[Vector3] = []
var patrol_points: Array[Vector3] = []
var rings: Array[MeshInstance3D] = []
var city_bodies: Array[StaticBody3D] = []

var _material_cache: Dictionary = {}
var _district := DetailedDistrict.new()
var _sun := DirectionalLight3D.new()

func _ready() -> void:
	var layout: Dictionary = GameData.get_data().city
	for point: Array in layout.titanSpawnPoints:
		spawn_points.append(GameData.vec(point))
	for point: Array in layout.patrolWaypoints:
		patrol_points.append(GameData.vec(point))
	_build_ground(float(layout.halfSize))
	_build_walls(layout)
	_build_towers(layout.towers)
	_district.name = "DetailedDistrict"
	add_child(_district)
	_build_districts(layout.buildings)
	_build_depots(layout.supplyStations)
	_build_trees(layout.trees)
	_light_world()

func _build_ground(half_size: float) -> void:
	var width := half_size * 2.4
	var ground_size := Vector3(width, 2, width)
	_box_collision(Vector3.DOWN, ground_size, "City Ground", false)
	var cobble := Image.create_empty(256, 256, false, Image.FORMAT_RGB8)
	cobble.fill(Color("3a3d42"))
	for y in range(0, 256, 16):
		var offset := 0 if y % 32 == 0 else 12
		for x in range(-16, 256, 24):
			var shade := 52 + (x * 13 + y * 7) % 22
			_paint(cobble, Rect2i(x + offset + 1, y + 1, 21, 13), Color8(shade, shade + 2, shade + 5))
	var material := _textured(cobble)
	material.uv1_scale = Vector3(45, 45, 1)
	_plane(Vector3.ZERO, Vector2(width, width), material)
	_plane(Vector3(0, 0.02, 0), Vector2(20, half_size * 2), _material("2c3038"))
	_plane(Vector3(0, 0.025, 0), Vector2(half_size * 2, 20), _material("2c3038"))

func _build_walls(layout: Dictionary) -> void:
	for wall: Dictionary in layout.walls:
		var center := GameData.vec(wall.pos)
		var size := GameData.vec(wall.size)
		_box_collision(center, size, wall.label)
		_box(center, size, _material("6c7078"))
	var wall_height := float(layout.walls[0].size[1]) + 4.0
	for step in range(-120, 121, 40):
		for side in [-1, 1]:
			var edge: float = side * float(layout.halfSize)
			_box(Vector3(step, wall_height / 2, edge), Vector3(6, wall_height, 14), _material("50545c"))
			_box(Vector3(edge, wall_height / 2, step), Vector3(14, wall_height, 6), _material("50545c"))

func _build_towers(towers: Array) -> void:
	for tower: Dictionary in towers:
		var center := GameData.vec(tower.center)
		var size := GameData.vec(tower.halfExtents) * 2.0
		_box_collision(center, size, tower.label)
		_box(center, size, _material("7b808a"))
		var roof_height: float = tower.spireHeight
		var roof := _mesh(_cylinder(0, size.x * 0.82, roof_height, 4),
			center + Vector3.UP * (size.y + roof_height) * 0.5, _material("8f3428"))
		roof.rotation.y = PI / 4.0

func _build_districts(buildings: Array) -> void:
	var facades: Array[StandardMaterial3D] = []
	for tint in ["d8cbb8", "cbbba4", "e0d5c3", "bfa98e"]:
		facades.append(_facade(tint))
	for building: Dictionary in buildings:
		var base := Vector3(building.bx, 0, building.bz)
		var width: float = building.width
		var depth: float = building.depth
		var height: float = building.bodyHeight
		var roof_height: float = building.roofHeight
		var index := int(building.index)
		_box_collision(GameData.vec(building.colliderCenter), GameData.vec(building.halfExtents) * 2, building.label)
		if _has_detailed_facade(base):
			_district.add_building(base, width, depth, building.totalColliderH, roof_height)
			continue
		_box(base + Vector3.UP * height * 0.5, Vector3(width, height, depth), facades[index % facades.size()])
		var roof := _mesh(_cylinder(0, maxf(width, depth) * 0.74, roof_height, 4),
			base + Vector3.UP * (height + roof_height * 0.5),
			_material("3d4856" if index % 4 == 0 else "9b3b2a"))
		roof.rotation.y = PI / 4.0
		_box(base + Vector3.UP * height * 0.65, Vector3(width + 1.2, 0.8, depth + 1.2), _material("3b281e"))

func _has_detailed_facade(base: Vector3) -> bool:
	return (absf(base.x) == 26.0 and (base.z < 0.0 or base.z == 52.0)) \
		or (absf(base.x) == 52.0 and absf(base.z) == 26.0)

func _build_depots(depots: Array) -> void:
	for point: Array in depots:
		var center := GameData.vec(point)
		supply_points.append(center)
		_box_collision(center + Vector3.UP * 1.5, Vector3(3, 3, 3), "Supply Depot #%s" % supply_points.size())
		_mesh(_cylinder(3.2, 3.6, 0.6, 8), center + Vector3.UP * 0.3, _material("4b5563"))
		_box(center + Vector3.UP * 1.7, Vector3(2.4, 2.2, 2.4), _material("78502b"))
		var beacon := StandardMaterial3D.new()
		beacon.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		beacon.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		beacon.cull_mode = BaseMaterial3D.CULL_DISABLED
		beacon.albedo_color = Color("38d9c059")
		var shape := _cylinder(1.4, 1.4, 22, 12)
		shape.cap_top = false
		shape.cap_bottom = false
		_mesh(shape, center + Vector3.UP * 11.0, beacon).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _build_trees(trees: Array) -> void:
	var trunks := MultiMesh.new()
	var crowns := MultiMesh.new()
	for instances in [trunks, crowns]:
		instances.transform_format = MultiMesh.TRANSFORM_3D
		instances.instance_count = trees.size()
	var trunk := _cylinder(0.45, 0.65, 6.0, 7)
	trunk.material = _material("4a3525")
	trunks.mesh = trunk
	var crown := _cylinder(0.0, 3.2, 8.5, 7)
	crown.material = _material("2d5a36")
	crowns.mesh = crown
	for index in trees.size():
		var tree: Dictionary = trees[index]
		var base := GameData.vec(tree.pos)
		trunks.set_instance_transform(index, Transform3D(Basis.IDENTITY, base + Vector3.UP * 3.0))
		crowns.set_instance_transform(index, Transform3D(Basis.IDENTITY, base + Vector3.UP * 8.5))
		var shape := CylinderShape3D.new()
		shape.radius = tree.radius
		shape.height = float(tree.halfHeight) * 2
		_collision(GameData.vec(tree.colliderCenter), shape, tree.label, true)
	for instances in [trunks, crowns]:
		var node := MultiMeshInstance3D.new()
		node.multimesh = instances
		add_child(node)

func _light_world() -> void:
	var world_env := WorldEnvironment.new()
	var environment := Environment.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color("405b78")
	sky_material.sky_horizon_color = Color("b5c4cb")
	sky_material.ground_horizon_color = Color("b5c4cb")
	sky_material.ground_bottom_color = Color("464d53")
	var sky := Sky.new()
	sky.sky_material = sky_material
	environment.background_mode = Environment.BG_SKY
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("c6d7e6")
	environment.ambient_light_energy = 0.50
	environment.fog_enabled = true
	environment.fog_light_color = Color("a7b8c4")
	environment.fog_density = 0.0014
	world_env.environment = environment
	add_child(world_env)
	_sun.name = "Sun"
	_sun.rotation_degrees = Vector3(-41, -54, 0)
	_sun.light_color = Color("fff0d7")
	_sun.light_energy = 1.03
	_sun.shadow_enabled = true
	add_child(_sun)

func set_training(enabled: bool) -> void:
	for ring in rings:
		ring.queue_free()
	rings.clear()
	if not enabled:
		return
	for point in TRAINING_RINGS:
		var shape := TorusMesh.new()
		shape.inner_radius = 3.32
		shape.outer_radius = 3.88
		shape.rings = 24
		shape.ring_segments = 10
		var ring := _mesh(shape, point, _material("38d9c0", true))
		ring.rotation.x = PI / 2
		rings.append(ring)

func collect_rings(feet: Vector3) -> int:
	var count := 0
	for ring in rings:
		if not ring.has_meta("passed") and ring.position.distance_to(feet) < 5.5:
			ring.set_meta("passed", true)
			ring.material_override = _material("22c55e", true)
			count += 1
	return count

func nearby_depot(feet: Vector3) -> bool:
	for point in supply_points:
		if feet.distance_to(point) <= 8.5:
			return true
	return false

func set_quality(quality: int) -> void:
	var viewport := get_viewport()
	viewport.scaling_3d_scale = 1.0
	match quality:
		0:
			viewport.msaa_3d = Viewport.MSAA_DISABLED
			viewport.anisotropic_filtering_level = Viewport.ANISOTROPY_2X
		1:
			viewport.msaa_3d = Viewport.MSAA_2X
			viewport.anisotropic_filtering_level = Viewport.ANISOTROPY_4X
		_:
			viewport.msaa_3d = Viewport.MSAA_4X
			viewport.anisotropic_filtering_level = Viewport.ANISOTROPY_8X
	_sun.shadow_enabled = quality > 0
	_sun.directional_shadow_max_distance = 105.0 if quality >= 2 else 70.0

func _box_collision(center: Vector3, size: Vector3, label: String, grappleable := true) -> void:
	var shape := BoxShape3D.new()
	shape.size = size
	_collision(center, shape, label, grappleable)

func _collision(center: Vector3, shape: Shape3D, label: String, grappleable: bool) -> void:
	var body := StaticBody3D.new()
	body.position = center
	body.collision_layer = 1
	body.collision_mask = 0
	body.set_meta("grappleable", grappleable)
	body.set_meta("label", label)
	var collider := CollisionShape3D.new()
	collider.shape = shape
	body.add_child(collider)
	add_child(body)
	city_bodies.append(body)

func _facade(tint: String) -> StandardMaterial3D:
	var image := Image.create_empty(256, 256, false, Image.FORMAT_RGB8)
	image.fill(Color(tint))
	for step in range(0, 257, 64):
		_paint(image, Rect2i(0, step - 3, 256, 6), Color("3b281e"))
		_paint(image, Rect2i(step - 3, 0, 6, 256), Color("3b281e"))
	for row in 4:
		for column in 4:
			var window := Vector2i(column * 64 + 18, row * 64 + 14)
			_paint(image, Rect2i(window - Vector2i(2, 2), Vector2i(32, 38)), Color("241811"))
			_paint(image, Rect2i(window, Vector2i(28, 34)), Color("f3c66f" if (row * 7 + column * 3) % 5 == 0 else "263547"))
			_paint(image, Rect2i(window + Vector2i(13, 0), Vector2i(2, 34)), Color("241811"))
			_paint(image, Rect2i(window + Vector2i(0, 16), Vector2i(28, 2)), Color("241811"))
	return _textured(image)

func _paint(image: Image, rect: Rect2i, color: Color) -> void:
	image.fill_rect(rect.intersection(Rect2i(0, 0, 256, 256)), color)

func _textured(image: Image) -> StandardMaterial3D:
	image.generate_mipmaps()
	var material := StandardMaterial3D.new()
	material.albedo_texture = ImageTexture.create_from_image(image)
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	material.roughness = 0.85
	return material

func _material(color: String, unlit := false) -> StandardMaterial3D:
	if not _material_cache.has(color):
		var material := StandardMaterial3D.new()
		material.albedo_color = Color(color)
		material.roughness = 0.83
		if unlit:
			material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_material_cache[color] = material
	return _material_cache[color]

func _plane(center: Vector3, size: Vector2, material: Material) -> void:
	var shape := PlaneMesh.new()
	shape.size = size
	_mesh(shape, center, material).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _box(center: Vector3, size: Vector3, material: Material) -> void:
	var shape := BoxMesh.new()
	shape.size = size
	_mesh(shape, center, material)

func _cylinder(top: float, bottom: float, height: float, segments: int) -> CylinderMesh:
	var shape := CylinderMesh.new()
	shape.top_radius = top
	shape.bottom_radius = bottom
	shape.height = height
	shape.radial_segments = segments
	shape.rings = 1
	return shape

func _mesh(shape: Mesh, center: Vector3, material: Material) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.mesh = shape
	node.position = center
	node.material_override = material
	add_child(node)
	return node
