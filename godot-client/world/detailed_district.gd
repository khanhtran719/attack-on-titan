extends Node3D

const WALL := preload("res://assets/training_street/Wall_Plaster_Straight.gltf")
const WINDOW := preload("res://assets/training_street/Window_Wide_Flat1.gltf")
const ROOF := preload("res://assets/training_street/Roof_RoundTiles_8x8.gltf")
const GABLE := preload("res://assets/training_street/Roof_Front_Brick8.gltf")

var _wall: Mesh
var _window: Mesh
var _roof: Mesh
var _gable: Mesh

func _ready() -> void:
	_wall = _source_mesh(WALL)
	_window = _source_mesh(WINDOW)
	_roof = _source_mesh(ROOF)
	_gable = _source_mesh(GABLE)

func add_building(base: Vector3, width: float, depth: float, height: float, roof_height: float) -> void:
	var batches: Dictionary[String, SurfaceTool] = {}
	var floors := maxi(1, roundi(height / 3.5))
	for face in 4:
		var rotation := Basis(Vector3.UP, face * PI * 0.5)
		var end_wall := face % 2 == 0
		var span := width if end_wall else depth
		var face_depth := (depth if end_wall else width) * 0.5
		_add_facade(batches, rotation, span, face_depth, height / floors, floors)
	var eaves := height - 0.10
	var roof_rise := roof_height * 0.5
	_append(batches, _roof, Transform3D(
		Basis.from_scale(Vector3((width + 0.85) / 9.95, roof_rise / 6.0, (depth + 0.75) / 10.33)),
		Vector3.UP * eaves))
	for side in [-1.0, 1.0]:
		var rotation := Basis(Vector3.UP, PI if side < 0 else 0.0)
		var scaled := rotation.scaled_local(Vector3((width - 0.45) / 8.51, roof_rise / 5.4, 0.46))
		_append(batches, _gable, Transform3D(scaled, Vector3(0.0, eaves, side * depth * 0.5)))
	var mesh := ArrayMesh.new()
	for batch: SurfaceTool in batches.values():
		batch.commit(mesh)
	var building := MeshInstance3D.new()
	building.mesh = mesh
	building.position = base
	add_child(building)

func _add_facade(batches: Dictionary[String, SurfaceTool], rotation: Basis, span: float,
		face_depth: float, floor_height: float, floors: int) -> void:
	var bays := maxi(1, roundi(span / 3.6))
	var bay_width := span / bays
	var wall_basis := rotation.scaled_local(Vector3(bay_width / 2.0, floor_height / 3.0, 0.60))
	var window_basis := rotation.scaled_local(Vector3(bay_width / 2.35, floor_height / 3.5, 0.48))
	for floor_index in floors:
		for bay in bays:
			var offset := Vector3(-span * 0.5 + bay_width * (bay + 0.5), floor_height * floor_index, face_depth)
			_append(batches, _wall, Transform3D(wall_basis, rotation * offset))
			if floor_index > 0 or bay % 2 == 0:
				offset.z += 0.04
				_append(batches, _window, Transform3D(window_basis, rotation * offset))

func _append(batches: Dictionary[String, SurfaceTool], mesh: Mesh, transform: Transform3D) -> void:
	for surface in mesh.get_surface_count():
		var material := mesh.surface_get_material(surface)
		var key := material.resource_name
		if not batches.has(key):
			var batch := SurfaceTool.new()
			batch.begin(Mesh.PRIMITIVE_TRIANGLES)
			batch.set_material(material)
			batches[key] = batch
		batches[key].append_from(mesh, surface, transform)

func _source_mesh(scene: PackedScene) -> Mesh:
	var source := scene.instantiate()
	var node := source.find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D
	var mesh := node.mesh
	for surface in mesh.get_surface_count():
		var material := mesh.surface_get_material(surface) as StandardMaterial3D
		material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		material.normal_scale = 0.5
	source.free()
	return mesh
