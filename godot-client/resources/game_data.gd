class_name TitanGameData
extends RefCounted

const SOURCE := "res://resources/game_data.json"
static var data: Dictionary

static func get_data() -> Dictionary:
	if data.is_empty():
		data = JSON.parse_string(FileAccess.get_file_as_string(SOURCE))
	return data

static func vec(values: Array) -> Vector3:
	return Vector3(values[0], values[1], values[2])
