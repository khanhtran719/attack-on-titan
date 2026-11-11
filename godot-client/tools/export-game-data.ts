import { writeFileSync } from 'node:fs';
import { GAME_CONFIG } from '../../src/config/GameConfig';
import { generateCityLayoutDescriptors } from '../../src/shared/CityLayout';

const path = new URL('../resources/game_data.json', import.meta.url);
const data = {
  config: GAME_CONFIG,
  city: generateCityLayoutDescriptors(),
};
writeFileSync(path, JSON.stringify(data, (key, value) => {
  return value?.isVector3 ? value.toArray() : value;
}, 2) + '\n');
