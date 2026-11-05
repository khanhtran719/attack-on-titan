import * as THREE from 'three';
import { GAME_CONFIG } from '../config/GameConfig';
import { PhysicsWorld } from '../physics/PhysicsWorld';

export interface BuildingDescriptor {
  index: number;
  bx: number;
  bz: number;
  width: number;
  depth: number;
  bodyHeight: number;
  roofHeight: number;
  totalColliderH: number;
  colliderCenter: THREE.Vector3;
  halfExtents: THREE.Vector3;
  label: string;
}

export interface WallSegmentDescriptor {
  pos: THREE.Vector3;
  size: THREE.Vector3;
  halfExtents: THREE.Vector3;
  label: string;
}

export interface TowerDescriptor {
  id: string;
  center: THREE.Vector3;
  width: number;
  height: number;
  spireHeight: number;
  halfExtents: THREE.Vector3;
  label: string;
}

export interface TreeDescriptor {
  pos: THREE.Vector3;
  colliderCenter: THREE.Vector3;
  halfHeight: number;
  radius: number;
  label: string;
}

export interface CityLayoutData {
  halfSize: number;
  walls: WallSegmentDescriptor[];
  towers: TowerDescriptor[];
  buildings: BuildingDescriptor[];
  trees: TreeDescriptor[];
  supplyStations: THREE.Vector3[];
  titanSpawnPoints: THREE.Vector3[];
  patrolWaypoints: THREE.Vector3[];
  playerSpawnPoints: THREE.Vector3[];
}

/**
 * Generates the deterministic Valkenburg City structural descriptors without any DOM/WebGL/Physics side effects.
 * Shared as the single source of truth by both Client (`CityBuilder`) and Server (`CoopHunterRoom`).
 */
export function generateCityLayoutDescriptors(): CityLayoutData {
  const halfSize = GAME_CONFIG.world.citySize * 0.5; // 150m
  const walls: WallSegmentDescriptor[] = [];
  const towers: TowerDescriptor[] = [];
  const buildings: BuildingDescriptor[] = [];
  const trees: TreeDescriptor[] = [];
  const supplyStations: THREE.Vector3[] = [];
  const titanSpawnPoints: THREE.Vector3[] = [];
  const patrolWaypoints: THREE.Vector3[] = [];

  // 1. Outer Fortified Walls
  const wallH = GAME_CONFIG.world.wallHeight;
  const wallT = GAME_CONFIG.world.wallThickness;
  const span = halfSize * 2 + wallT;
  const rawSegments = [
    {
      pos: new THREE.Vector3(0, wallH / 2, -halfSize),
      size: new THREE.Vector3(span, wallH, wallT),
    },
    {
      pos: new THREE.Vector3(0, wallH / 2, halfSize),
      size: new THREE.Vector3(span, wallH, wallT),
    },
    {
      pos: new THREE.Vector3(-halfSize, wallH / 2, 0),
      size: new THREE.Vector3(wallT, wallH, span),
    },
    {
      pos: new THREE.Vector3(halfSize, wallH / 2, 0),
      size: new THREE.Vector3(wallT, wallH, span),
    },
  ];
  for (const seg of rawSegments) {
    walls.push({
      pos: seg.pos,
      size: seg.size,
      halfExtents: new THREE.Vector3(
        seg.size.x / 2,
        seg.size.y / 2,
        seg.size.z / 2
      ),
      label: 'Outer Wall Maria',
    });
  }

  // 2. Central Bell Watchtower + 4 Avenue Corner Watchtowers (ensuring grapple anchors in all directions around plaza)
  const towerH = 34;
  const towerW = 7.5;
  towers.push({
    id: 'tower_central_bell',
    center: new THREE.Vector3(0, towerH / 2, 0),
    width: towerW,
    height: towerH,
    spireHeight: 11,
    halfExtents: new THREE.Vector3(towerW / 2, towerH / 2, towerW / 2),
    label: 'Central Bell Tower',
  });

  const plazaCornerCoords: Array<[number, number]> = [
    [-20, -20],
    [20, -20],
    [-20, 20],
    [20, 20],
  ];
  plazaCornerCoords.forEach(([cx, cz], idx) => {
    const cH = 24;
    const cW = 5.2;
    towers.push({
      id: `tower_plaza_${idx + 1}`,
      center: new THREE.Vector3(cx, cH / 2, cz),
      width: cW,
      height: cH,
      spireHeight: 7,
      halfExtents: new THREE.Vector3(cW / 2, cH / 2, cW / 2),
      label: `Plaza Watchtower #${idx + 1}`,
    });
  });

  // 3. Modular District Buildings
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
      const bodyHeight = 14 + ((seed >> 5) % 18);
      const roofHeight = 4.5 + (seed % 3);
      const totalColliderH = bodyHeight + roofHeight * 0.5;

      buildings.push({
        index: bIndex,
        bx,
        bz,
        width,
        depth,
        bodyHeight,
        roofHeight,
        totalColliderH,
        colliderCenter: new THREE.Vector3(bx, totalColliderH / 2, bz),
        halfExtents: new THREE.Vector3(width / 2, totalColliderH / 2, depth / 2),
        label: `District Building #${bIndex}`,
      });

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

  // 4. Supply Stations
  const depotLocations = [
    new THREE.Vector3(16, 0, 16),
    new THREE.Vector3(-65, 0, 0),
    new THREE.Vector3(65, 0, 0),
    new THREE.Vector3(0, 0, -65),
  ];
  for (const pos of depotLocations) {
    supplyStations.push(pos.clone());
  }

  // 5. Avenue Trees
  for (let i = -125; i <= 125; i += 25) {
    if (Math.abs(i) < 18) continue;
    const treeCoords = [
      new THREE.Vector3(i, 0, -12),
      new THREE.Vector3(i, 0, 12),
      new THREE.Vector3(-12, 0, i),
      new THREE.Vector3(12, 0, i),
    ];
    for (const pos of treeCoords) {
      trees.push({
        pos,
        colliderCenter: new THREE.Vector3(pos.x, 5.5, pos.z),
        halfHeight: 5.5,
        radius: 0.8,
        label: 'City Tree',
      });
    }
  }

  // 6. Squad Spawn Points in the Southern Plaza facing the Bell Tower & Northern Avenue
  const playerSpawnPoints = [
    new THREE.Vector3(-3.5, 0.2, 24),
    new THREE.Vector3(3.5, 0.2, 24),
    new THREE.Vector3(-7.0, 0.2, 27),
    new THREE.Vector3(7.0, 0.2, 27),
  ];

  return {
    halfSize,
    walls,
    towers,
    buildings,
    trees,
    supplyStations,
    titanSpawnPoints,
    patrolWaypoints,
    playerSpawnPoints,
  };
}

/**
 * Populates a Rapier PhysicsWorld with the exact deterministic Valkenburg City colliders
 * using the single shared `generateCityLayoutDescriptors()` source of truth.
 */
export function populateCityPhysicsWorld(physics: PhysicsWorld): CityLayoutData {
  const layout = generateCityLayoutDescriptors();

  // 1. Ground slab
  physics.addStaticBox(
    new THREE.Vector3(0, -1.0, 0),
    new THREE.Vector3(layout.halfSize * 1.2, 1.0, layout.halfSize * 1.2),
    { type: 'ground', grappleable: false, label: 'City Ground' }
  );

  // 2. Outer Fortified Walls
  for (const wall of layout.walls) {
    physics.addStaticBox(wall.pos, wall.halfExtents, {
      type: 'wall',
      grappleable: true,
      label: wall.label,
    });
  }

  // 3. Watchtowers (Central Bell Tower + 4 Plaza Corner Watchtowers)
  for (const tower of layout.towers) {
    physics.addStaticBox(tower.center, tower.halfExtents, {
      type: 'tower',
      grappleable: true,
      label: tower.label,
    });
  }

  // 4. District Buildings
  for (const b of layout.buildings) {
    physics.addStaticBox(b.colliderCenter, b.halfExtents, {
      type: 'building',
      grappleable: true,
      label: b.label,
    });
  }

  // 5. Supply Stations
  layout.supplyStations.forEach((pos, idx) => {
    physics.addStaticBox(
      new THREE.Vector3(pos.x, 1.5, pos.z),
      new THREE.Vector3(1.5, 1.5, 1.5),
      {
        type: 'resupply',
        grappleable: true,
        label: `Supply Depot #${idx + 1}`,
      }
    );
  });

  // 6. Avenue Trees
  for (const tree of layout.trees) {
    physics.addStaticCylinder(
      tree.colliderCenter,
      tree.halfHeight,
      tree.radius,
      { type: 'tree', grappleable: true, label: tree.label }
    );
  }

  // CRITICAL: Step Rapier world once after adding static colliders so its
  // internal BVH / QueryPipeline is immediately populated for raycasting
  // on both client and server!
  physics.step();

  return layout;
}
