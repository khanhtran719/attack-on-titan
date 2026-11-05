import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import {
  CityLayoutData,
  populateCityPhysicsWorld,
} from '../shared/CityLayout';

export interface SupplyStation {
  id: string;
  position: THREE.Vector3;
  beaconMesh: THREE.Mesh;
}

export interface TrainingRing {
  id: number;
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  passed: boolean;
}

export class CityBuilder {
  private cityGroup: THREE.Group = new THREE.Group();
  private supplyStations: SupplyStation[] = [];
  private trainingRings: TrainingRing[] = [];
  private titanSpawnPoints: THREE.Vector3[] = [];
  private patrolWaypoints: THREE.Vector3[] = [];

  constructor(
    private scene: THREE.Scene,
    private physics: PhysicsWorld
  ) {
    this.cityGroup.name = 'ValkenburgCity';
    this.scene.add(this.cityGroup);
  }

  public buildWorld(includeTrainingCourse = false): void {
    this.clearWorld();

    // Populate Rapier 3D colliders from the single shared CityLayout source of truth
    const layout = populateCityPhysicsWorld(this.physics);
    this.titanSpawnPoints = layout.titanSpawnPoints.map((p) => p.clone());
    this.patrolWaypoints = layout.patrolWaypoints.map((p) => p.clone());

    // 1. Ground & Cobblestone Plaza
    this.buildGroundVisuals(layout.halfSize);

    // 2. Outer Fortified Wall & Gatehouses
    this.buildOuterWallsVisuals(layout);

    // 3. Central Plaza Monument & Watchtowers
    this.buildWatchtowersVisuals(layout);

    // 4. Modular European District Buildings
    this.buildCityDistrictsVisuals(layout);

    // 5. Military Supply Stations (Resupply Depots)
    this.buildSupplyStationsVisuals(layout);

    // 6. Instanced Trees, Rocks & Props
    this.buildInstancedFoliageVisuals(layout);

    // 7. Optional Training Aerial Checkpoints
    if (includeTrainingCourse) {
      this.buildTrainingCourse();
    }
  }

  private clearWorld(): void {
    while (this.cityGroup.children.length > 0) {
      const child = this.cityGroup.children[0];
      this.cityGroup.remove(child);
    }
    this.supplyStations = [];
    this.trainingRings = [];
    this.titanSpawnPoints = [];
    this.patrolWaypoints = [];
  }

  private createCobbleTexture(): THREE.Texture {
    if (typeof document === 'undefined') {
      return new THREE.Texture();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Texture();
    ctx.fillStyle = '#3a3d42';
    ctx.fillRect(0, 0, 256, 256);

    for (let y = 0; y < 256; y += 16) {
      const offset = (y / 16) % 2 === 0 ? 0 : 12;
      for (let x = -16; x < 256; x += 24) {
        const shade = 52 + ((x * 13 + y * 7) % 22);
        ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 5})`;
        ctx.fillRect(x + offset + 1, y + 1, 21, 13);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(45, 45);
    return tex;
  }

  private createFacadeTexture(tintHex: string): THREE.Texture {
    if (typeof document === 'undefined') {
      return new THREE.Texture();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Texture();

    // Plaster background
    ctx.fillStyle = tintHex;
    ctx.fillRect(0, 0, 256, 256);

    // Timber framing beams
    ctx.fillStyle = '#3b281e';
    for (let y = 0; y <= 256; y += 64) {
      ctx.fillRect(0, y - 3, 256, 6);
    }
    for (let x = 0; x <= 256; x += 64) {
      ctx.fillRect(x - 3, 0, 6, 256);
    }

    // Warm lit / darkpaned windows
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const wx = col * 64 + 18;
        const wy = row * 64 + 14;
        const isLit = (row * 7 + col * 3) % 5 === 0;
        ctx.fillStyle = '#241811';
        ctx.fillRect(wx - 2, wy - 2, 32, 38);
        ctx.fillStyle = isLit ? '#f3c66f' : '#263547';
        ctx.fillRect(wx, wy, 28, 34);
        // Window mullion cross
        ctx.fillStyle = '#241811';
        ctx.fillRect(wx + 13, wy, 2, 34);
        ctx.fillRect(wx, wy + 16, 28, 2);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  private buildGroundVisuals(halfSize: number): void {
    const cobbleTex = this.createCobbleTexture();
    const groundGeo = new THREE.PlaneGeometry(halfSize * 2.4, halfSize * 2.4);
    const groundMat = new THREE.MeshStandardMaterial({
      map: cobbleTex,
      roughness: 0.88,
      metalness: 0.05,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this.cityGroup.add(groundMesh);

    // Main cross-avenue road strips
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x2c3038,
      roughness: 0.9,
    });
    const nsRoad = new THREE.Mesh(
      new THREE.PlaneGeometry(20, halfSize * 2),
      roadMat
    );
    nsRoad.rotation.x = -Math.PI / 2;
    nsRoad.position.y = 0.02;
    nsRoad.receiveShadow = true;
    this.cityGroup.add(nsRoad);

    const ewRoad = new THREE.Mesh(
      new THREE.PlaneGeometry(halfSize * 2, 20),
      roadMat
    );
    ewRoad.rotation.x = -Math.PI / 2;
    ewRoad.position.y = 0.025;
    ewRoad.receiveShadow = true;
    this.cityGroup.add(ewRoad);
  }

  private buildOuterWallsVisuals(layout: CityLayoutData): void {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x6c7078,
      roughness: 0.85,
      metalness: 0.1,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x50545c,
      roughness: 0.9,
    });

    for (const seg of layout.walls) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(seg.size.x, seg.size.y, seg.size.z),
        wallMat
      );
      mesh.position.copy(seg.pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.cityGroup.add(mesh);
    }

    const wallH = layout.walls[0]?.size.y ?? 32;
    const halfSize = layout.halfSize;

    // Visual Buttress pillars along the outer walls
    for (let i = -120; i <= 120; i += 40) {
      for (const side of [-1, 1]) {
        const pillarN = new THREE.Mesh(
          new THREE.BoxGeometry(6, wallH + 4, 14),
          trimMat
        );
        pillarN.position.set(i, (wallH + 4) / 2, side * halfSize);
        pillarN.castShadow = true;
        this.cityGroup.add(pillarN);

        const pillarE = new THREE.Mesh(
          new THREE.BoxGeometry(14, wallH + 4, 6),
          trimMat
        );
        pillarE.position.set(side * halfSize, (wallH + 4) / 2, i);
        pillarE.castShadow = true;
        this.cityGroup.add(pillarE);
      }
    }
  }

  private buildWatchtowersVisuals(layout: CityLayoutData): void {
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x7b808a,
      roughness: 0.75,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x8f3428,
      roughness: 0.7,
    });

    for (const tower of layout.towers) {
      const towerMesh = new THREE.Mesh(
        new THREE.BoxGeometry(tower.width, tower.height, tower.width),
        stoneMat
      );
      towerMesh.position.copy(tower.center);
      towerMesh.castShadow = true;
      towerMesh.receiveShadow = true;
      this.cityGroup.add(towerMesh);

      const spireMesh = new THREE.Mesh(
        new THREE.ConeGeometry(tower.width * 0.82, tower.spireHeight, 4),
        roofMat
      );
      spireMesh.position.set(
        tower.center.x,
        tower.height + tower.spireHeight * 0.5,
        tower.center.z
      );
      spireMesh.rotation.y = Math.PI / 4;
      spireMesh.castShadow = true;
      this.cityGroup.add(spireMesh);
    }
  }

  private buildCityDistrictsVisuals(layout: CityLayoutData): void {
    const facadeColors = ['#d8cbb8', '#cbbba4', '#e0d5c3', '#bfa98e'];
    const facadeMats = facadeColors.map((hex) => {
      const tex = this.createFacadeTexture(hex);
      return new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.82,
      });
    });

    const roofMatRed = new THREE.MeshStandardMaterial({
      color: 0x9b3b2a,
      roughness: 0.72,
    });
    const roofMatSlate = new THREE.MeshStandardMaterial({
      color: 0x3d4856,
      roughness: 0.75,
    });
    const balconyMat = new THREE.MeshStandardMaterial({
      color: 0x3b281e,
      roughness: 0.85,
    });

    for (const b of layout.buildings) {
      const mat = facadeMats[b.index % facadeMats.length];
      const buildingGroup = new THREE.Group();
      buildingGroup.position.set(b.bx, 0, b.bz);

      // Main building body
      const bodyGeo = new THREE.BoxGeometry(b.width, b.bodyHeight, b.depth);
      const bodyMesh = new THREE.Mesh(bodyGeo, mat);
      bodyMesh.position.y = b.bodyHeight / 2;
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      buildingGroup.add(bodyMesh);

      // Pitched gabled roof
      const roofGeo = new THREE.ConeGeometry(
        Math.max(b.width, b.depth) * 0.74,
        b.roofHeight,
        4
      );
      const roofMesh = new THREE.Mesh(
        roofGeo,
        b.index % 4 === 0 ? roofMatSlate : roofMatRed
      );
      roofMesh.position.y = b.bodyHeight + b.roofHeight / 2;
      roofMesh.rotation.y = Math.PI / 4;
      roofMesh.castShadow = true;
      buildingGroup.add(roofMesh);

      // Overhanging wooden balcony on upper floors
      const balMesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.width + 1.2, 0.8, b.depth + 1.2),
        balconyMat
      );
      balMesh.position.y = b.bodyHeight * 0.65;
      buildingGroup.add(balMesh);

      this.cityGroup.add(buildingGroup);
    }
  }

  private buildSupplyStationsVisuals(layout: CityLayoutData): void {
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x4b5563,
      roughness: 0.6,
      metalness: 0.4,
    });
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x78502b,
      roughness: 0.8,
    });
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x38d9c0,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });

    layout.supplyStations.forEach((pos, idx) => {
      const group = new THREE.Group();
      group.position.copy(pos);

      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.6, 0.6, 8),
        baseMat
      );
      platform.position.y = 0.3;
      platform.receiveShadow = true;
      group.add(platform);

      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 2.2, 2.4),
        crateMat
      );
      crate.position.y = 1.7;
      crate.castShadow = true;
      group.add(crate);

      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.4, 22, 12, 1, true),
        beaconMat
      );
      beacon.position.y = 11;
      group.add(beacon);

      this.cityGroup.add(group);

      this.supplyStations.push({
        id: `supply_${idx + 1}`,
        position: pos.clone(),
        beaconMesh: beacon,
      });
    });
  }

  private buildInstancedFoliageVisuals(layout: CityLayoutData): void {
    const count = layout.trees.length;
    if (count === 0) return;

    const trunkGeo = new THREE.CylinderGeometry(0.45, 0.65, 6, 7);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x4a3525,
      roughness: 0.9,
    });
    const canopyGeo = new THREE.ConeGeometry(3.2, 8.5, 7);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x2d5a36,
      roughness: 0.8,
    });

    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const canopyInst = new THREE.InstancedMesh(canopyGeo, canopyMat, count);
    trunkInst.castShadow = true;
    canopyInst.castShadow = true;

    const dummy = new THREE.Object3D();
    layout.trees.forEach((tree, idx) => {
      dummy.position.set(tree.pos.x, 3.0, tree.pos.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(tree.pos.x, 8.5, tree.pos.z);
      dummy.updateMatrix();
      canopyInst.setMatrixAt(idx, dummy.matrix);
    });

    trunkInst.instanceMatrix.needsUpdate = true;
    canopyInst.instanceMatrix.needsUpdate = true;
    this.cityGroup.add(trunkInst);
    this.cityGroup.add(canopyInst);
  }

  private buildTrainingCourse(): void {
    const ringGeo = new THREE.TorusGeometry(3.6, 0.28, 10, 24);
    const ringPillarCoords = [
      new THREE.Vector3(0, 12, -25),
      new THREE.Vector3(0, 15, -52),
      new THREE.Vector3(14, 16, -78),
    ];

    ringPillarCoords.forEach((pos, idx) => {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x38d9c0,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.position.copy(pos);
      this.cityGroup.add(mesh);
      this.trainingRings.push({
        id: idx + 1,
        position: pos.clone(),
        mesh,
        passed: false,
      });
    });
  }

  public getSupplyStations(): SupplyStation[] {
    return this.supplyStations;
  }

  public getTrainingRings(): TrainingRing[] {
    return this.trainingRings;
  }

  public getTitanSpawnPoints(): THREE.Vector3[] {
    return this.titanSpawnPoints;
  }

  public getPatrolWaypoints(): THREE.Vector3[] {
    return this.patrolWaypoints;
  }
}
