import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import './styles.css';

const MODEL_PATH = '/models/3DModel_Simulation.fbx';

const assets = [
  { id: 'P01', label: '조립 셀', status: 'online' },
  { id: 'P02', label: '로봇 팔 A', status: 'online' },
  { id: 'P03', label: '로봇 팔 B', status: 'online' },
  { id: 'P04', label: '랙 온도 센서', status: 'alert' },
  { id: 'P05', label: '컨베이어 노드', status: 'online' },
  { id: 'P06', label: '비전 검사 구역', status: 'online' },
  { id: 'P07', label: '열처리 구역', status: 'alert' },
  { id: 'P08', label: '포장 라인', status: 'online' },
];

const alertMessages = [
  { level: 'critical', code: 'P04', text: '랙 온도 급증' },
  { level: 'warning', code: 'R03', text: '로봇 작업 주기 오차' },
  { level: 'warning', code: 'P07', text: '열 변형 감지' },
  { level: 'info', code: 'P02', text: '유지보수 준비 완료' },
  { level: 'info', code: 'R01', text: '영점 조정 완료' },
  { level: 'warning', code: 'P05', text: '컨베이어 하중 불균형' },
  { level: 'info', code: 'P06', text: '비전 검사 통과' },
];

const kpis = [
  { label: '설비 가동률', unit: '%', value: 92, min: 88, max: 98, accent: 'cyan' },
  { label: '로봇 작업 효율', unit: '%', value: 88, min: 82, max: 96, accent: 'blue' },
  { label: '차량 준비 상태', unit: '%', value: 95, min: 90, max: 99, accent: 'green' },
  { label: '주변 온도', unit: '°C', value: 25.3, min: 23.8, max: 27.4, accent: 'orange' },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

function makeSeries(length = 10) {
  return Array.from({ length }, () => Math.round(randomBetween(14, 34)));
}

function makeLiveKpis(source = kpis) {
  return source.map((kpi) => {
    const drift = kpi.unit === '°C' ? randomBetween(-0.35, 0.35) : randomBetween(-3, 3);
    const value = clamp(kpi.value + drift, kpi.min, kpi.max);

    return {
      ...kpi,
      value: kpi.unit === '°C' ? Number(value.toFixed(1)) : Math.round(value),
      points: makeSeries(),
    };
  });
}

function makeLiveAlerts() {
  const now = Date.now();

  return alertMessages.slice(0, 5).map((alert, index) => ({
    ...alert,
    time: formatTime(new Date(now - index * randomBetween(180000, 520000))),
  }));
}

function useLiveTelemetry() {
  const [telemetry, setTelemetry] = useState(() => ({
    assets,
    alerts: makeLiveAlerts(),
    kpis: makeLiveKpis(),
    tick: 0,
  }));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTelemetry((current) => {
        const kpisNext = makeLiveKpis(current.kpis);
        const alertAssetIds = new Set(['P04', 'P07', Math.random() > 0.55 ? 'P05' : 'P03']);

        return {
          assets: assets.map((asset) => ({
            ...asset,
            status: alertAssetIds.has(asset.id) ? 'alert' : 'online',
          })),
          alerts: makeLiveAlerts(),
          kpis: kpisNext,
          tick: current.tick + 1,
        };
      });
    }, 1800);

    return () => window.clearInterval(interval);
  }, []);

  const summary = useMemo(() => {
    const warnings = telemetry.assets.filter((asset) => asset.status === 'alert').length;

    return {
      machines: telemetry.assets.length + 4,
      robots: 3,
      vehicles: 3,
      faults: warnings > 2 ? 1 : 0,
      online: telemetry.assets.length - warnings + 4,
      warnings,
      idle: 0,
    };
  }, [telemetry.assets]);

  return { ...telemetry, summary };
}

function fitCameraToObject(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  const fitHeightDistance = maxSize / (2 * Math.atan((Math.PI * camera.fov) / 360));
  const distance = fitHeightDistance * 1.2;

  camera.position.set(center.x + distance, center.y + distance * 0.58, center.z + distance * 0.92);
  camera.near = Math.max(distance / 120, 0.01);
  camera.far = distance * 120;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function ModelViewport() {
  const mountRef = useRef(null);
  const modelRef = useRef(null);
  const frameRef = useRef(0);
  const robotsRef = useRef([]);
  const [partNames, setPartNames] = useState([]);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#03261E');

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    camera.position.set(6, 4, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;

    scene.add(new THREE.HemisphereLight('#ffffff', '#062920', 1.25));

    const keyLight = new THREE.DirectionalLight('#ffffff', 1.8);
    keyLight.position.set(7, 10, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 50;
    keyLight.shadow.camera.left = -15;
    keyLight.shadow.camera.right = 15;
    keyLight.shadow.camera.top = 15;
    keyLight.shadow.camera.bottom = -15;
    scene.add(keyLight);

    const rimLight = new THREE.PointLight('#38bdf8', 1.5);
    rimLight.position.set(-6, 4, -4);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(22, 22, '#0d4a3b', '#062f25');
    scene.add(grid);

    new FBXLoader().load(
      MODEL_PATH,
      (model) => {
        const foundNames = [];
        const robots = [];
        model.traverse((child) => {
          if (child.name && child.name !== 'Scene') {
             foundNames.push(`${child.name} (${child.type})`);
          }
          if (child.name && child.name.startsWith('Robotic_Arm')) {
             const parent = child.parent;
             if (!parent.userData.initialPosition) {
               parent.userData.initialPosition = parent.position.clone();
               parent.userData.initialRotation = parent.rotation.clone();
               
               // 로봇 팔이 원점(0,0,0)을 돌며 날아가지 않도록 실제 무게중심(Pivot)을 계산
               const box = new THREE.Box3().setFromObject(child);
               const center = new THREE.Vector3();
               box.getCenter(center);
               
               // 회전축(Pivot) 그룹 생성 (바닥 중심점 기준)
               const pivot = new THREE.Group();
               pivot.position.set(center.x, box.min.y, center.z);
               
               // 부모(대차)에 pivot을 넣고, child(로봇 팔)를 pivot 안으로 이동
               parent.add(pivot);
               pivot.add(child);
               
               // child의 위치를 역으로 이동시켜 겉보기 위치는 그대로 유지
               child.position.set(-center.x, -box.min.y, -center.z);
               
               parent.userData.armPivot = pivot;
               pivot.userData.initialRotation = pivot.rotation.clone();
               
               robots.push(parent);
             }
          }
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            
            if (child.material) {
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              materials.forEach(mat => {
                if (mat.isMeshPhongMaterial) {
                  mat.shininess = Math.max(mat.shininess, 30);
                }
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                  mat.roughness = Math.max(0.1, mat.roughness - 0.15);
                  mat.metalness = Math.min(1.0, mat.metalness + 0.15);
                }
              });
            }
          }
        });

        robotsRef.current = robots;
        setPartNames([...new Set(foundNames)]);
        modelRef.current = model;
        scene.add(model);
        fitCameraToObject(camera, controls, model);
      },
      undefined,
      undefined,
    );

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };

    const clock = new THREE.Clock();

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      
      const time = clock.getElapsedTime();
      robotsRef.current.forEach((robot, i) => {
        const startPos = robot.userData.initialPosition;
        const armPivot = robot.userData.armPivot;
        
        if (robot.name === 'Group57') {
          // Group57은 본체(차량)는 제자리에 고정하고, 로봇 팔만 회전시킵니다.
          robot.position.copy(startPos);
          robot.rotation.copy(robot.userData.initialRotation);
          
          // 새로 계산된 중심축(Pivot)을 기준으로 팔을 부드럽게 회전
          armPivot.rotation.y = armPivot.userData.initialRotation.y + Math.sin(time * 1.5) * 1.0;
        } else {
          // 나머지 로봇들은 본체가 통로 라인을 따라 이동
          const moveOffset = Math.sin(time * 0.7 + i * 2.5) * 0.35;
          robot.position.z = startPos.z + moveOffset;
          robot.rotation.copy(robot.userData.initialRotation);
          
          // 이 로봇들의 팔은 고정 상태 유지
          armPivot.rotation.copy(armPivot.userData.initialRotation);
        }
      });

      controls.update();
      renderer.render(scene, camera);
    };

    resize();
    animate();
    window.addEventListener('resize', resize);

    return () => {
        window.removeEventListener('resize', resize);
        cancelAnimationFrame(frameRef.current);
        if (mount.contains(renderer.domElement)) {
          mount.removeChild(renderer.domElement);
        }
      };
  }, []);

  return (
    <section className="viewport-panel">
      <div ref={mountRef} className="viewport" />
      <div className="view-cube" aria-hidden="true">
        <span>3D</span>
      </div>
    </section>
  );
}

function Sidebar({ assets: liveAssets, summary }) {
  const [activeFilter, setActiveFilter] = useState('목록');
  const filters = ['목록', '그리드', '필터'];

  return (
    <aside className="sidebar">
      <div className="brand">
        <button className="menu-button" type="button" aria-label="Menu">메뉴</button>
        <span className="brand-icon">FL</span>
        <div>
          <h1>FactoryLens</h1>
          <p>디지털 트윈 관제</p>
        </div>
      </div>

      <div className="filter-tabs" aria-label="Asset filters">
        {filters.map((filter) => (
          <button
            key={filter}
            className={filter === activeFilter ? 'active' : ''}
            onClick={() => setActiveFilter(filter)}
            type="button"
          >
            {filter}
          </button>
        ))}
      </div>

      <div className="asset-summary">
        <span><b className="ok-dot" />{summary.online}</span>
        <span><b className="warn-dot" />{summary.warnings}</span>
        <span><b className="idle-dot" />{summary.idle}</span>
      </div>

      <div className="search-row">
        <button type="button">전체</button>
        <input aria-label="Search assets" placeholder="설비 검색" />
      </div>

      <div className="asset-list">
        {liveAssets.map((asset) => (
          <button
            className={asset.status === 'alert' ? 'asset-row active-alert' : 'asset-row'}
            type="button"
            key={asset.id}
          >
            <span className={asset.status === 'alert' ? 'asset-thumb alert' : 'asset-thumb'} />
            <span>
              <strong>{asset.id}</strong>
              <small>{asset.label}</small>
            </span>
            <b className={asset.status === 'alert' ? 'dot warning' : 'dot'} />
          </button>
        ))}
      </div>
    </aside>
  );
}

function TopNav() {
  const items = ['홈', '설비', '분석', '로봇', '보고서', '설정'];
  const [activeTab, setActiveTab] = useState('홈');

  return (
    <nav className="top-nav" aria-label="Main navigation">
      {items.map((item) => (
        <button 
          className={item === activeTab ? 'active' : ''} 
          onClick={() => setActiveTab(item)}
          type="button" 
          key={item}
        >
          {item}
        </button>
      ))}
      <div className="user-pill">
        <span className="online-dot" />
        <span>운영자</span>
      </div>
    </nav>
  );
}

function StatusStrip({ summary }) {
  const values = [
    ['기계 설비', summary.machines],
    ['로봇 장비', summary.robots],
    ['운송 차량', summary.vehicles],
    ['발생 오류', summary.faults],
  ];

  return (
    <div className="status-strip">
      {values.map(([label, value]) => (
        <div className="status-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function AlertPanel({ alerts: liveAlerts }) {
  const [activeTab, setActiveTab] = useState('알림');
  const tabs = ['알림', '작업', '기록'];

  return (
    <aside className="right-panel">
      <div className="panel-tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={tab === activeTab ? 'active' : ''}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="alert-list">
        {liveAlerts.map((alert) => (
          <button
            className={`alert-row ${alert.level}`}
            type="button"
            key={`${alert.code}-${alert.time}`}
          >
            <b>{alert.level === 'critical' ? '!' : alert.level === 'warning' ? '^' : 'i'}</b>
            <span>
              <strong>{alert.text}</strong>
              <small>{alert.code}</small>
            </span>
            <time>{alert.time}</time>
          </button>
        ))}
      </div>
    </aside>
  );
}

function KpiCard({ label, value, unit, accent, points }) {
  const displayValue = unit === '°C' ? `${value.toFixed(1)}°C` : `${value}%`;
  const ringValue = unit === '°C' ? Math.round(((value - 22) / 8) * 100) : value;

  return (
    <article className={`kpi-card ${accent}`} style={{ '--ring': `${clamp(ringValue, 0, 100)}%` }}>
      <div className="kpi-ring"><span>{displayValue}</span></div>
      <div>
        <strong>{label}</strong>
        <div className="sparkline" aria-hidden="true">
          {points.map((height, index) => (
            <i style={{ height }} key={`${label}-${index}`} />
          ))}
        </div>
      </div>
    </article>
  );
}

function App() {
  const { assets: liveAssets, alerts: liveAlerts, kpis: liveKpis, summary, tick } = useLiveTelemetry();

  return (
    <main className="app-shell" data-tick={tick}>
      <Sidebar assets={liveAssets} summary={summary} />
      <section className="content">
        <TopNav />
        <StatusStrip summary={summary} />
        <div className="main-grid">
          <ModelViewport />
          <AlertPanel alerts={liveAlerts} />
        </div>
        <section className="kpi-grid" aria-label="Operational KPIs">
          {liveKpis.map((kpi) => (
            <KpiCard {...kpi} key={kpi.label} />
          ))}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
