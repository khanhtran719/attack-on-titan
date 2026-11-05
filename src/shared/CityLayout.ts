import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import { PhysicsWorld } from '../physics/PhysicsWorld';

export interface CityLayoutData {
  supplyStations: THREE.Vector3[];
  titanSpawnPoints: THREE.Vector3[];
  patrolWaypoints: THREE.Vector3[];
  playerSpawnPoints: THREE.Vector3[];
}

/**
 * Populates a Rapier PhysicsWorld with the exact deterministic Valkenburg City colliders
 * (ground, outer walls, central bell tower, 60 district buildings, supply depots, and trees)
 * without any DOM or WebGL dependencies. Used by the authoritative Node.js server.
 */
export function populateCityPhysicsWorld(physics: PhysicsWorld): CityLayoutData {
  const halfSize = GAME_CONFIG.world.citySize * 0.5; // 150m
  const supplyStations: THREE.Vector3[] = [];
  const titanSpawnPoints: THREE.Vector3[] = [];
  const patrolWaypoints: THREE.Vector3[] = [];

  // 1. Ground slab
  physics.addStaticBox(
    new THREE.Vector3(0, -1.0, 0),
    new THREE.Vector3(halfSize * 1.2, 1.0, halfSize * 1.2),
    { type: 'ground', grappleable: false, label: 'City Ground' }
  );

  // 2. Outer Fortified Walls
  const wallH = GAME_CONFIG.world.wallHeight;
  const wallT = GAME_CONFIG.world.wallThickness;
  const span = halfSize * 2 + wallT;
  const segments = [
    { pos: new THREE.Vector3(0, wallH / 2, -halfSize), size: new THREE.Vector3(span, wallH, wallT) },
    { pos: new THREE.Vector3(0, wallH / 2, halfSize), size: new THREE.Vector3(span, wallH, wallT) },
    { pos: new THREE.Vector3(-halfSize, wallH / 2, 0), size: new THREE.Vector3(wallT, wallH, span) },
    { pos: new THREE.Vector3(halfSize, wallH / 2, 0), size: new THREE.Vector3(wallT, wallH, span) },
  ];
  for (const seg of segments) {
    physics.addStaticBox(
      seg.pos,
      new THREE.Vector3(seg.size.x / 2, seg.size.y / 2, seg.size.z / 2),
      { type: 'wall', grappleable: true, label: 'Outer Wall Maria' }
    );
  }

  // 3. Central Bell Watchtower
  const towerH = 34;
  const towerW = 7.5;
  physics.addStaticBox(
    new THREE.Vector3(0, towerH / 2, 0),
    new THREE.Vector3(towerW / 2, towerH / 2, towerW / 2),
    { type: 'tower', grappleable: true, label: 'Central Bell Tower' }
  );

  // 4. Modular District Buildings
  const blockCoords = [-112, -82, -52, -26, 26, 52, 82, 112];
  let bIndex = 0;
  for (const bx of blockCoords) {
    for (const bz of blockCoords) {
      if (Math.abs(bx) === 26 && Math.abs(bz) === 26) {
        patrolWaypoints.push(new THREE.Vector3(bx, 0, bz));
        continue;
      }
      if (Math.abs(bx) === 112 && Math.abs(bz) === 112) {
        titanSpawnPoints.push(new THREE.Vector3(bx, 0, bz));
        continue;
      }
      bIndex++;
      const seed = (bx * 37 + bz * 53 + bIndex * 19) & 0xffff;
      const width = 12 + (seed % 7);
      const depth = 12 + ((seed >> 3) % 7);
      const height = 14 + ((seed >> 5) % 18);
      const roofH = 4.5 + (seed % 3);
      const totalColliderH = height + roofH * 0.5;

      physics.addStaticBox(
        new THREE.Vector3(bx, totalColliderH / 2, bz),
        new THREE.Vector3(width / 2, totalColliderH / 2, depth / 2),
        {
          type: 'building',
          grappleable: true,
          label: `District Building #${bIndex}`,
        }
      );

      if (bIndex % 3 === 0) {
        patrolWaypoints.push(new THREE.Vector3(bx + width * 0.5 + 6, 0, bz));
      }
    }
  }

  titanSpawnPoints.push(
    new THREE.Vector3(0, 0, -115),
    new THREE.Vector3(0, 0, 115),
    new THREE.Vector3(-115, 0, 0),
    new THREE.Vector3(115, 0, 0),
    new THREE.Vector3(-68, 0, -68),
    new THREE.Vector3(68, 0, -68),
    new THREE.Vector3(-68, 0, 68),
    new THREE.Vector3(68, 0, 68)
  );

  // 5. Supply Stations
  const depotLocations = [
    new THREE.Vector3(16, 0, 16),
    new THREE.Vector3(-65, 0, 0),
    new THREE.Vector3(65, 0, 0),
    new THREE.Vector3(0, 0, -65),
  ];
  depotLocations.forEach((pos, idx) => {
    physics.addStaticBox(
      new THREE.Vector3(pos.x, 1.5, pos.z),
      new THREE.Vector3(1.5, 1.5, 1.5),
      {
        type: 'resupply',
        grappleable: true,
        label: `Supply Depot #${idx + 1}`,
      }
    );
    supplyStations.push(pos.clone());
  });

  // 6. Avenue Trees
  for (let i = -125; i <= 125; i += 25) {
    if (Math.abs(i) < 18) continue;
    const treeCoords = [
      new THREE.Vector3(i, 0, -12),
      new THREE.Vector3(i, 0, 12),
      new THREE.Vector3(-12, 0, i),
      new THREE.Vector3(12, 0, i),
    ];
    for (const pos of treeCoords) {
      physics.addStaticCylinder(
        new THREE.Vector3(pos.x, 5.5, pos.z),
        5.5,
        0.8,
        { type: 'tree', grappleable: true, label: 'City Tree' }
      );
    }
  }

  // 4 Squad Spawn Points in the Southern Plaza facing the Bell Tower
  const playerSpawnPoints = [
    new THREE.Vector3(-3.5, 0.2, 24),
    new THREE.Vector3(3.5, 0.2, 24),
    new THREE.Vector3(-7.0, 0.2, 27),
    new THREE.Vector3(7.0, 0.2, 27),
  ];

  return {
    supplyStations,
    titanSpawnPoints,
    patrolWaypoints,
    playerSpawnPoints,
  };
}
