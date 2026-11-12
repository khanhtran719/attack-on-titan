extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var city_script := load("res://world/city.gd") as GDScript
	if city_script == null:
		quit(1)
		return
	var city: Node3D = city_script.new()
	root.add_child(city)
	await physics_frame
	await physics_frame
	var ray := PhysicsRayQueryParameters3D.create(Vector3(0, 8, 12), Vector3(0, 8, 0), 1)
	var tower := city.get_world_3d().direct_space_state.intersect_ray(ray)
	var ground_ray := PhysicsRayQueryParameters3D.create(Vector3(0, 3, 24), Vector3(0, -3, 24), 1)
	var ground := city.get_world_3d().direct_space_state.intersect_ray(ground_ray)
	if city.spawn_points.size() != 12 or city.supply_points.size() != 4 or tower.is_empty() or ground.is_empty():
		push_error("City layout or collision mismatch")
		quit(1)
		return
	if absf(tower.position.z - 3.75) > 0.05 or not tower.collider.get_meta("grappleable") or ground.collider.get_meta("grappleable"):
		push_error("City grapple metadata or tower surface mismatch")
		quit(1)
		return
	var building_ray := PhysicsRayQueryParameters3D.create(Vector3(0, 7, -52), Vector3(-26, 7, -52), 1)
	var before := city.get_world_3d().direct_space_state.intersect_ray(building_ray)
	var district := city.get_node_or_null("DetailedDistrict") as Node3D
	if before.is_empty() or district == null or not district.visible or district.get_child_count() != 12:
		push_error("Detailed façades should cover 12 buildings around the plaza and North Avenue")
		quit(1)
		return
	var sun := city.get_node("Sun") as DirectionalLight3D
	city.set_quality(0)
	if root.msaa_3d != Viewport.MSAA_DISABLED or sun.shadow_enabled:
		push_error("Low quality should disable MSAA and shadows")
		quit(1)
		return
	city.set_quality(1)
	if root.msaa_3d != Viewport.MSAA_2X or not sun.shadow_enabled:
		push_error("Medium quality should enable 2x MSAA and shadows")
		quit(1)
		return
	city.set_quality(2)
	if root.msaa_3d != Viewport.MSAA_4X or root.scaling_3d_scale != 1.0:
		push_error("High quality should use 4x MSAA at full render resolution")
		quit(1)
		return
	city.set_training(true)
	var during := city.get_world_3d().direct_space_state.intersect_ray(building_ray)
	if during.get("rid") != before.rid or during.get("position") != before.position:
		push_error("Detailed buildings should preserve the shared grapple collider in Training")
		quit(1)
		return
	if city.rings.size() != 3 or city.collect_rings(Vector3(0, 12, -25)) != 1 or city.collect_rings(Vector3(0, 12, -25)) != 0:
		push_error("Training ring collection mismatch")
		quit(1)
		return
	city.set_training(false)
	if not district.visible or not city.rings.is_empty():
		push_error("Detailed façades should stay visible when Training rings are cleared")
		quit(1)
		return
	print("PASS city layout, graphics presets, detailed façades, grapple collider and ring reset")
	quit()
