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
	city.set_training(true)
	if city.rings.size() != 3 or city.collect_rings(Vector3(0, 12, -25)) != 1 or city.collect_rings(Vector3(0, 12, -25)) != 0:
		push_error("Training ring collection mismatch")
		quit(1)
		return
	print("PASS city descriptor counts, geometry, hook metadata and ring reset")
	quit()
