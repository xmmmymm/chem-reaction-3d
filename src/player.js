// 化学反应微观 3D 播放器（由 tools/build-player.mjs 从 网页/ 自动生成，勿手改）
// 用法：
//   const p = ChemPlayer.create(reactionsArray);
//   p.start();        // 构建卡片 / 3D / 步骤条
//   p.destroy();      // 卸载并释放 WebGL 与事件
(function () {
    function create(ALL) {
        let DATA = ALL[0], curIdx = 0;
        let destroyed = false;
        let META = DATA.meta, COND = DATA.conditions || {}, UI = DATA.ui || {};
        const ACCENTS = { amber:'#f59e0b', indigo:'#6366f1', emerald:'#10b981', sky:'#0ea5e9',
            violet:'#8b5cf6', rose:'#f43f5e', cyan:'#06b6d4', red:'#ef4444', green:'#22c55e',
            orange:'#f97316', blue:'#3b82f6', slate:'#64748b', teal:'#14b8a6' };
        let ACC = ACCENTS[META.accent] || ACCENTS.indigo;
        function hexToRgba(h, a) { const n = parseInt(h.slice(1), 16);
            return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`; }
        document.documentElement.style.setProperty('--accent', ACC);
        document.documentElement.style.setProperty('--accent-soft', hexToRgba(ACC, 0.25));

        // Light scene palette (single theme)
        const SCENE_BG = 0xeef2f7, BOND_COLOR = 0x94a3b8;
        const BROKEN_COLOR = 0xf59e0b, BROKEN_EMIT = 0xef4444, FORMED_COLOR = 0x34d399, FORMED_EMIT = 0x059669;

        // Phase boundaries (approach / transition / separate)
        const P1 = 0.4, P2 = 0.7;
        function phaseOf(p) {
            if (p < P1) return { phase: 1, t: p / P1 };
            if (p <= P2) return { phase: 2, t: (p - P1) / (P2 - P1) };
            return { phase: 3, t: (p - P2) / (1 - P2) };
        }
        const smooth = t => t * t * (3 - 2 * t);

        // ---- State ----
        let scene, camera, renderer, controls;
        let progress = 0, isPlaying = false, playRAF = null, slideRAF = null;
        let showFlame = true, showCatalyst = true, showLabels = true;
        const container = document.getElementById('canvas-container');
        let atoms = {};       // id -> {el, mesh, start, end, cur, frag, flocal}
        let fragments = {};    // id -> {catalyst, K0,K1,K2, curPos, curRot, sprite, light}
        const bondList = [];     // {a,b,order,kind, cyls:[]}
        let flameLight, flameSprite, transitionLight;
        const electronSprites = [];

        // ===== Geometry helpers =====
        const geomCache = {};
        function sphereGeom(r) { const k = r.toFixed(3);
            return geomCache[k] || (geomCache[k] = new THREE.SphereGeometry(r, 28, 28)); }
        const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);

        function radialGlow(color) {
            const c = document.createElement('canvas'); c.width = c.height = 64;
            const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
            g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, color);
            g.addColorStop(0.5, hexToRgba(color, 0.4)); g.addColorStop(1, 'rgba(0,0,0,0)');
            x.fillStyle = g; x.fillRect(0, 0, 64, 64);
            return new THREE.CanvasTexture(c);
        }

        // ===== Build scene =====
        function init3D() {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(SCENE_BG);
            scene.fog = new THREE.FogExp2(SCENE_BG, 0.022);
            camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
            camera.position.set(0, 4, 13);
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(container.clientWidth, container.clientHeight);
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            container.appendChild(renderer.domElement);

            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true; controls.dampingFactor = 0.05;
            controls.maxDistance = 28; controls.minDistance = 3;

            scene.add(new THREE.AmbientLight(0xffffff, 0.7));
            const dir = new THREE.DirectionalLight(0xffffff, 1.05);
            dir.position.set(5, 12, 8); dir.castShadow = true;
            dir.shadow.mapSize.set(2048, 2048); dir.shadow.bias = -0.001; scene.add(dir);
            const fill = new THREE.DirectionalLight(0x93c5fd, 0.35); fill.position.set(-6, -5, -4); scene.add(fill);

            transitionLight = new THREE.PointLight(0xffcc00, 0, 14);
            transitionLight.position.set(0, 0.4, 0); scene.add(transitionLight);

            if (COND.flame) {
                flameLight = new THREE.PointLight(0xff7a18, 0, 16);
                flameLight.position.set(0, 0.5, 0); scene.add(flameLight);
                flameSprite = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: radialGlow('#ffae00'), color: 0xff8a00, transparent: true,
                    blending: THREE.AdditiveBlending, opacity: 0 }));
                flameSprite.scale.set(0.1, 0.1, 0.1); flameSprite.position.set(0, 0.5, 0); scene.add(flameSprite);
            }

            const grid = new THREE.GridHelper(34, 34, 0xcbd5e1, 0xe2e8f0); grid.position.y = -4.5; scene.add(grid);
            const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.10 }));
            floor.rotation.x = -Math.PI / 2; floor.position.y = -4.45; floor.receiveShadow = true; scene.add(floor);

            buildAtoms(); buildFragments(); buildBonds(); buildElectrons();
            window.addEventListener('resize', onResize);
        }

        // 原子描一圈深色边，在浅色背景上提升对比（教科书球棍图风）
        const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x334155, side: THREE.BackSide });
        function buildAtoms() {
            DATA.atoms.forEach(a => {
                const mat = new THREE.MeshStandardMaterial({ color: a.color, roughness: 0.3, metalness: 0.05 });
                const mesh = new THREE.Mesh(sphereGeom(a.radius), mat);
                mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
                const outline = new THREE.Mesh(sphereGeom(a.radius), OUTLINE_MAT);
                outline.scale.setScalar(1.07); mesh.add(outline);
                atoms[a.id] = {
                    el: a.el, mesh, radius: a.radius,
                    start: new THREE.Vector3().fromArray(a.start),
                    end: new THREE.Vector3().fromArray(a.end),
                    cur: new THREE.Vector3().fromArray(a.start),
                    frag: a.frag || null,
                    flocal: a.flocal ? new THREE.Vector3().fromArray(a.flocal) : null,
                };
            });
        }

        function buildFragments() {
            (DATA.fragments || []).forEach(f => {
                const frag = { catalyst: !!f.catalyst, K0: f.K0, K1: f.K1, K2: f.K2,
                    curPos: new THREE.Vector3(), curRot: [0, 0, 0] };
                if (f.catalyst) {
                    frag.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                        map: radialGlow('#0891b2'), color: 0x0891b2, transparent: true,
                        blending: THREE.NormalBlending, opacity: 0.85 }));
                    frag.sprite.scale.set(1.3, 1.3, 1.3); scene.add(frag.sprite);
                    frag.light = new THREE.PointLight(0x22d3ee, 1.0, 4); scene.add(frag.light);
                }
                fragments[f.id] = frag;
            });
        }

        function makeBondMat() {
            return new THREE.MeshStandardMaterial({ color: BOND_COLOR, roughness: 0.4, metalness: 0.1,
                transparent: true, opacity: 1, emissive: 0x000000, emissiveIntensity: 0 });
        }
        function buildBonds() {
            const add = (b, kind) => {
                const count = (b.order === 2) ? 2 : (b.order === 3 ? 3 : 1);
                const cyls = [];
                for (let i = 0; i < count; i++) {
                    const m = new THREE.Mesh(cylGeo, makeBondMat()); m.castShadow = true; m.visible = false;
                    scene.add(m); cyls.push(m);
                }
                bondList.push({ a: b.a, b: b.b, order: b.order, ionic: b.order === 'ionic', kind, cyls });
            };
            DATA.bonds.kept.forEach(b => add(b, 'kept'));
            DATA.bonds.broken.forEach(b => add(b, 'broken'));
            DATA.bonds.formed.forEach(b => add(b, 'formed'));
        }

        function buildElectrons() {
            (DATA.electrons || []).forEach(() => {
                const s = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: radialGlow('#0e7490'), color: 0x0891b2, transparent: true,
                    blending: THREE.NormalBlending, opacity: 0 }));
                s.scale.set(0.5, 0.5, 0.5); scene.add(s); electronSprites.push(s);
            });
        }

        // ===== Position resolvers =====
        function molBob(seed, time) {
            let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997;
            const ph = h * 0.0063;
            return new THREE.Vector3(Math.sin(time * 0.6 + ph) * 0.11,
                Math.cos(time * 0.5 + ph) * 0.11, Math.sin(time * 0.4 + ph) * 0.09);
        }
        function morphPositions(p, time) {
            const ph = phaseOf(p);
            for (const id in atoms) {
                const a = atoms[id];
                if (ph.phase === 1) {
                    a.cur.copy(a.start).add(molBob(a.frag || 'r', time));
                } else if (ph.phase === 2) {
                    const t = smooth(ph.t), amp = 0.1 * Math.sin(ph.t * Math.PI);
                    a.cur.lerpVectors(a.start, a.end, t);
                    a.cur.x += (Math.random() - 0.5) * amp;
                    a.cur.y += (Math.random() - 0.5) * amp;
                    a.cur.z += (Math.random() - 0.5) * amp;
                } else {
                    a.cur.copy(a.end).add(molBob(a.frag || 'p', time));
                }
                a.mesh.position.copy(a.cur);
            }
        }
        const _eu = new THREE.Euler();
        function lerpArr(A, B, t) { return [A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t]; }
        function mechanismPositions(p, time) {
            const ph = phaseOf(p);
            for (const fid in fragments) {
                const f = fragments[fid];
                let pos, rot;
                if (ph.phase === 1) { pos = lerpArr(f.K0.pos, f.K1.pos, ph.t); rot = lerpArr(f.K0.rot, f.K1.rot, ph.t); }
                else if (ph.phase === 2) {
                    const j = 0.045 * Math.sin(ph.t * Math.PI);
                    pos = [f.K1.pos[0] + (Math.random()-0.5)*j, f.K1.pos[1] + (Math.random()-0.5)*j, f.K1.pos[2] + (Math.random()-0.5)*j];
                    rot = f.K1.rot;
                } else { pos = lerpArr(f.K1.pos, f.K2.pos, ph.t); rot = lerpArr(f.K1.rot, f.K2.rot, ph.t); }
                f.curPos.set(pos[0], pos[1], pos[2]); f.curRot = rot;
                if (f.sprite) { f.sprite.position.copy(f.curPos); f.light.position.copy(f.curPos);
                    f.sprite.visible = f.light.visible = showCatalyst; }
            }
            for (const id in atoms) {
                const a = atoms[id]; const f = fragments[a.frag];
                if (!f || !a.flocal) { a.mesh.position.copy(a.cur); continue; }
                _eu.set(f.curRot[0], f.curRot[1], f.curRot[2]);
                a.cur.copy(a.flocal).applyEuler(_eu).add(f.curPos);
                a.mesh.position.copy(a.cur);
                if (f.catalyst) a.mesh.visible = showCatalyst;
            }
        }

        // ===== Bonds =====
        const _dir = new THREE.Vector3(), _mid = new THREE.Vector3(), _perp = new THREE.Vector3(),
              _up = new THREE.Vector3(0, 1, 0);
        function placeCyl(mesh, A, B, radius, opacity, color, emit, emitI) {
            if (opacity <= 0.02) { mesh.visible = false; return; }
            mesh.visible = true;
            _dir.subVectors(B, A); const len = _dir.length();
            mesh.scale.set(radius, len, radius);
            _mid.addVectors(A, B).multiplyScalar(0.5); mesh.position.copy(_mid);
            mesh.quaternion.setFromUnitVectors(_up, _dir.clone().normalize());
            mesh.material.opacity = opacity; mesh.material.color.setHex(color);
            mesh.material.emissive.setHex(emit); mesh.material.emissiveIntensity = emitI;
        }
        function drawBond(b, p) {
            const A = atoms[b.a].cur, B = atoms[b.b].cur;
            const ph = phaseOf(p);
            let opacity = 1, color = BOND_COLOR, emit = 0x000000, emitI = 0, glow = false;
            if (b.kind === 'broken') {
                if (ph.phase === 1) opacity = 1;
                else if (ph.phase === 2) { opacity = 1 - ph.t; glow = true; }
                else opacity = 0;
            } else if (b.kind === 'formed') {
                if (ph.phase === 1) opacity = 0;
                else if (ph.phase === 2) { opacity = ph.t; glow = true; }
                else opacity = 1;
            }
            if (glow) {
                const pulse = 1.0 + Math.sin(Date.now() * 0.01) * 0.5;
                if (b.kind === 'broken') { color = BROKEN_COLOR; emit = BROKEN_EMIT; }
                else { color = FORMED_COLOR; emit = FORMED_EMIT; }
                emitI = pulse;
            }
            const baseR = b.ionic ? 0.035 : (b.order === 2 || b.order === 3 ? 0.06 : 0.08);
            const op = b.ionic ? opacity * 0.5 : opacity;
            if (b.cyls.length === 1) {
                placeCyl(b.cyls[0], A, B, glow ? baseR * 0.85 : baseR, op, color, emit, emitI);
            } else {
                _dir.subVectors(B, A).normalize();
                _perp.set(-_dir.y, _dir.x, 0);
                if (_perp.lengthSq() < 0.01) _perp.set(0, -_dir.z, _dir.y);
                _perp.normalize().multiplyScalar(0.14);
                if (b.cyls.length === 2) {
                    placeCyl(b.cyls[0], A.clone().add(_perp), B.clone().add(_perp), baseR, op, color, emit, emitI);
                    placeCyl(b.cyls[1], A.clone().sub(_perp), B.clone().sub(_perp), baseR, op, color, emit, emitI);
                } else {
                    placeCyl(b.cyls[0], A, B, baseR, op, color, emit, emitI);
                    placeCyl(b.cyls[1], A.clone().add(_perp), B.clone().add(_perp), baseR, op, color, emit, emitI);
                    placeCyl(b.cyls[2], A.clone().sub(_perp), B.clone().sub(_perp), baseR, op, color, emit, emitI);
                }
            }
        }

        // ===== Overlays =====
        function updateFlame(p) {
            if (!COND.flame) return;
            const ph = phaseOf(p);
            let intensity = 0;
            if (ph.phase === 2) intensity = Math.sin(ph.t * Math.PI);
            else if (ph.phase === 3) intensity = Math.max(0, 1 - ph.t) * 0.3;
            if (!showFlame) intensity = 0;
            const flick = 0.85 + Math.sin(Date.now() * 0.03) * 0.15;
            flameLight.intensity = intensity * 6 * flick;
            flameSprite.material.opacity = intensity * flick;
            const s = 0.5 + intensity * 5.5 * flick; flameSprite.scale.set(s, s, s);
            flameSprite.visible = showFlame && intensity > 0.01;
        }
        function updateTransitionGlow(p) {
            const ph = phaseOf(p);
            const on = COND.transitionGlow || (DATA.fragments || []).length;
            transitionLight.intensity = (on && ph.phase === 2) ? Math.sin(ph.t * Math.PI) * 2.5 : 0;
        }
        function updateElectrons(p) {
            const defs = DATA.electrons || []; if (!defs.length) return;
            const ph = phaseOf(p);
            defs.forEach((d, i) => {
                const s = electronSprites[i]; if (!atoms[d.from] || !atoms[d.to]) return;
                if (ph.phase === 2) {
                    const t = smooth(ph.t);
                    s.position.lerpVectors(atoms[d.from].cur, atoms[d.to].cur, t);
                    s.position.y += Math.sin(ph.t * Math.PI) * 0.6;
                    s.material.opacity = Math.sin(ph.t * Math.PI);
                    s.visible = true;
                } else { s.visible = false; }
            });
        }

        // ===== Labels =====
        const _v = new THREE.Vector3(), _camUp = new THREE.Vector3();
        function buildLabels() {
            const overlay = document.getElementById('labels-overlay');
            (DATA.labels || []).forEach(l => {
                const el = document.createElement('div');
                el.id = 'lbl-' + l.id;
                el.className = 'absolute text-white text-xs font-semibold px-2 py-1 rounded shadow-lg transition-opacity duration-300 transform -translate-x-1/2 -translate-y-full border';
                const c = ({ red:'#ef4444', cyan:'#0891b2', blue:'#3b82f6', emerald:'#10b981', slate:'#475569',
                    violet:'#8b5cf6', green:'#16a34a', sky:'#0ea5e9', orange:'#f97316' })[l.color] || ACC;
                el.style.background = hexToRgba(c, 0.92); el.style.borderColor = hexToRgba(c, 1);
                el.textContent = l.text; el.dataset.phase = l.phase;
                overlay.appendChild(el); l._el = el; l._ids = l.atoms;
            });
        }
        function updateLabels(p) {
            const rect = container.getBoundingClientRect();
            const reactantPhase = p < 0.55;
            _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
            (DATA.labels || []).forEach(l => {
                const show = showLabels && (l.phase === 'reactant' ? reactantPhase : !reactantPhase);
                const el = l._el;
                if (!show) { el.style.opacity = '0'; return; }
                // Anchor above the molecule's topmost atom so the box never covers the bonds.
                let sx = 0, topY = Infinity, n = 0;
                for (const id of l._ids) {
                    const a = atoms[id];
                    _v.copy(a.cur).project(camera);
                    if (_v.z > 1) continue;
                    sx += (_v.x * 0.5 + 0.5) * rect.width;
                    _v.copy(a.cur).addScaledVector(_camUp, a.radius).project(camera);
                    topY = Math.min(topY, (_v.y * -0.5 + 0.5) * rect.height);
                    n++;
                }
                if (!n) { el.style.opacity = '0'; return; }
                el.style.opacity = '1';
                el.style.left = (sx / n) + 'px';
                el.style.top = (topY - 6) + 'px';
            });
        }

        // ===== Energy diagram =====
        function drawEnergy(p) {
            const E = DATA.energy; if (!E) return;
            const cv = document.getElementById('energy-canvas'), x = cv.getContext('2d');
            const W = cv.width, H = cv.height, pad = 14;
            x.clearRect(0, 0, W, H);
            const y0 = 0.72, act = E.activation != null ? E.activation : 0.7, dH = E.deltaH != null ? E.deltaH : -0.4;
            const yEnd = y0 + dH;
            const peakX = 0.45, peak = Math.max(y0, yEnd) + act * 0.5 + 0.1;
            const Y = v => pad + (1 - v) * (H - 2 * pad);
            const X = u => pad + u * (W - 2 * pad);
            // curve
            x.strokeStyle = ACC; x.lineWidth = 2; x.beginPath();
            for (let i = 0; i <= 60; i++) {
                const u = i / 60; let yv;
                if (u < peakX) { const k = u / peakX; yv = y0 + (peak - y0) * (k * k * (3 - 2 * k)); }
                else { const k = (u - peakX) / (1 - peakX); yv = peak + (yEnd - peak) * (k * k * (3 - 2 * k)); }
                const px = X(u), py = Y(yv); i ? x.lineTo(px, py) : x.moveTo(px, py);
            }
            x.stroke();
            // marker
            const u = Math.min(1, p); let yv;
            if (u < peakX) { const k = u / peakX; yv = y0 + (peak - y0) * (k * k * (3 - 2 * k)); }
            else { const k = (u - peakX) / (1 - peakX); yv = peak + (yEnd - peak) * (k * k * (3 - 2 * k)); }
            x.fillStyle = '#0f172a'; x.beginPath(); x.arc(X(u), Y(yv), 3.5, 0, 7); x.fill();
            // baseline labels
            x.fillStyle = '#64748b'; x.font = '9px sans-serif';
            x.fillText(E.reactantLabel || '反应物', pad, Y(y0) - 4);
            x.fillText(E.productLabel || '产物', W - pad - 26, Y(yEnd) - 4);
        }

        // ===== Render loop =====
        function animate() {
            if (destroyed) return;
            requestAnimationFrame(animate);
            controls.update();
            const p = progress / 100, time = Date.now() * 0.001;
            const pct = Math.round(progress);
            document.getElementById('progress-readout').textContent = pct + '%';
            document.getElementById('viewport-progress').style.width = pct + '%';

            if (META.engine === 'mechanism') mechanismPositions(p, time); else morphPositions(p, time);
            bondList.forEach(b => drawBond(b, p));
            updateFlame(p); updateTransitionGlow(p); updateElectrons(p);
            updateLabels(p); drawEnergy(p);
            updateStep(p);
            renderer.render(scene, camera);
        }

        // ===== Stepper / explanation =====
        let steps = DATA.steps || [];
        const STEP_INACTIVE = 'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300 bg-white border-slate-300 text-slate-400';
        function buildStepper() {
            const wrap = document.getElementById('stepper');
            steps.forEach((s, i) => {
                const btn = document.createElement('button');
                btn.className = 'flex flex-col items-center gap-2 cursor-pointer focus:outline-none';
                btn.onclick = () => jumpToStep(i + 1);
                btn.innerHTML = `<span id="step-circle-${i+1}" class="${STEP_INACTIVE}">${i+1}</span>
                    <span id="step-label-${i+1}" class="text-xs transition-colors duration-300 text-slate-400 max-w-[90px] text-center leading-tight">${s.title || ('步骤'+(i+1))}</span>`;
                wrap.appendChild(btn);
            });
        }
        let lastStep = -1;
        function stepIndexFor(p) {
            if (steps.length <= 1) return 1;
            if (p < P1) return 1;
            if (p <= P2) return Math.min(2, steps.length);
            return steps.length;
        }
        function updateStep(p) {
            const n = stepIndexFor(p);
            if (n === lastStep) return; lastStep = n;
            for (let i = 1; i <= steps.length; i++) {
                const circle = document.getElementById('step-circle-' + i);
                const label = document.getElementById('step-label-' + i);
                const on = i <= n;
                circle.style.background = on ? ACC : '';
                circle.style.borderColor = on ? ACC : '';
                circle.className = on
                    ? 'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300 text-white shadow-lg'
                    : STEP_INACTIVE;
                label.className = 'text-xs transition-colors duration-300 max-w-[90px] text-center leading-tight ' +
                    (on ? 'text-slate-800 font-semibold' : 'text-slate-400');
            }
            document.getElementById('step-progress-line').style.width = (((n - 1) / Math.max(1, steps.length - 1)) * 100) + '%';
            const s = steps[n - 1] || {};
            document.getElementById('step-title-text').textContent = `${n}. ${s.title || ''}`;
            document.getElementById('explanation-text').innerHTML = s.html || '';
        }

        // ===== Controls =====
        function jumpToStep(n) {
            const target = steps.length <= 1 ? 0 : Math.round(((n - 1) / (steps.length - 1)) * 100);
            animateSliderTo(target);
        }
        function animateSliderTo(target) {
            if (isPlaying) togglePlay();
            if (slideRAF) cancelAnimationFrame(slideRAF);
            const slider = document.getElementById('reaction-slider');
            (function step() {
                const cur = parseFloat(slider.value), diff = target - cur;
                if (Math.abs(diff) < 2) { slider.value = target; progress = target; }
                else { const nx = cur + Math.sign(diff) * 3; slider.value = nx; progress = nx; slideRAF = requestAnimationFrame(step); }
            })();
        }
        function togglePlay() {
            isPlaying = !isPlaying;
            const btn = document.getElementById('play-btn'), txt = document.getElementById('play-text');
            if (isPlaying) {
                if (progress >= 100) { progress = 0; document.getElementById('reaction-slider').value = 0; }
                txt.textContent = UI.pause || '暂停演示';
                btn.firstElementChild.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
                playLoop();
            } else {
                txt.textContent = UI.play || '自动演示';
                btn.firstElementChild.innerHTML = `<path d="M8 5v14l11-7z"/>`;
                if (playRAF) { cancelAnimationFrame(playRAF); playRAF = null; }
            }
        }
        function playLoop() {
            if (!isPlaying) return;
            progress += 0.5;
            if (progress >= 100) { progress = 100; document.getElementById('reaction-slider').value = 100; togglePlay(); return; }
            document.getElementById('reaction-slider').value = progress;
            playRAF = requestAnimationFrame(playLoop);
        }
        function onResize() {
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        }

        // ===== Static UI from data =====
        function paintStaticUI() {
            // 清空上次反应的守恒计数与图例（防跨切换累积）
            document.getElementById('conservation-chips').innerHTML = '';
            document.getElementById('legend-grid').innerHTML = '';
            document.title = (META.title || '化学反应') + ' · 微观3D演示';
            document.getElementById('page-title').textContent = (META.pageTitle || META.title || '化学反应');
            document.getElementById('eq-count').textContent = '共 ' + ALL.length + ' 个反应，当前 ' + (curIdx + 1) + '/' + ALL.length;
            document.documentElement.lang = META.language || 'zh-CN';
            document.getElementById('title').textContent = META.title || '';
            document.getElementById('subtitle').textContent = META.subtitle || '';
            document.getElementById('equation-container').innerHTML = '$$' + (META.equation || '') + '$$';
            document.getElementById('drag-hint').textContent = UI.drag || '拖拽旋转 · 滚轮缩放 · 右键平移';
            document.getElementById('progress-label').textContent = UI.progress || '反应进度';
            document.getElementById('slider-hint').textContent = UI.hint || '';
            document.getElementById('play-text').textContent = UI.play || '自动演示';
            document.getElementById('legend-label').textContent = UI.legend || '原子图例';
            document.getElementById('conservation-label').textContent = UI.conservation || '原子守恒';
            document.getElementById('labels-toggle-text').textContent = UI.labels || '标签';
            document.getElementById('labels-toggle').title = UI.labelsHint || '显示 / 隐藏标签';
            // conservation chips
            const chips = document.getElementById('conservation-chips');
            const colorOf = {}; (DATA.legend || []).forEach(l => colorOf[l.el] = l.color);
            Object.entries(DATA.elementCounts || {}).forEach(([el, n]) => {
                const d = document.createElement('div');
                d.className = 'flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs';
                d.innerHTML = `<span class="w-3 h-3 rounded-full inline-block" style="background:${colorOf[el]||'#94a3b8'}"></span>
                    <span class="text-slate-700 font-mono">${el} ×${n}</span>`;
                chips.appendChild(d);
            });
            // legend
            const lg = document.getElementById('legend-grid');
            (DATA.legend || []).forEach(l => {
                const d = document.createElement('div'); d.className = 'flex items-center space-x-2 text-slate-700';
                d.innerHTML = `<span class="w-3.5 h-3.5 rounded-full inline-block shrink-0" style="background:${l.color}"></span><span>${l.name} ${l.el}</span>`;
                lg.appendChild(d);
            });
            const tf = document.getElementById('toggle-flame');
            if (COND.flame) { tf.classList.remove('hidden'); tf.classList.add('flex'); }
            else { tf.classList.add('hidden'); tf.classList.remove('flex'); }
            const tc = document.getElementById('toggle-catalyst');
            if (COND.catalyst) {
                tc.classList.remove('hidden'); tc.classList.add('flex');
                document.getElementById('catalyst-title').textContent = (COND.catalyst.label || '催化剂');
            } else { tc.classList.add('hidden'); tc.classList.remove('flex'); }
            const ep = document.getElementById('energy-panel');
            if (DATA.energy) {
                ep.classList.remove('hidden');
                document.getElementById('energy-title').textContent = UI.energy || '能量·反应进程';
            } else { ep.classList.add('hidden'); }
        }

        function bindEvents() {
            const slider = document.getElementById('reaction-slider');
            slider.oninput = e => {
                if (isPlaying) togglePlay();
                if (slideRAF) { cancelAnimationFrame(slideRAF); slideRAF = null; }
                progress = parseFloat(e.target.value);
            }
            document.getElementById('play-btn').onclick = togglePlay;
            document.getElementById('reset-btn').onclick = () => {
                if (isPlaying) togglePlay();
                if (slideRAF) { cancelAnimationFrame(slideRAF); slideRAF = null; }
                progress = 0; slider.value = 0;
                camera.position.set(0, 4, 13); controls.target.set(0, 0, 0);
            }
            document.getElementById('prev-btn').onclick = () => jumpToStep(Math.max(1, stepIndexFor(progress / 100) - 1));
            document.getElementById('next-btn').onclick = () => jumpToStep(Math.min(steps.length, stepIndexFor(progress / 100) + 1));
            const ft = document.getElementById('flame-toggle');
            if (ft) ft.onchange = e => showFlame = e.target.checked;
            const ct = document.getElementById('catalyst-toggle');
            if (ct) ct.onchange = e => showCatalyst = e.target.checked;
            const EYE = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>`;
            const EYE_OFF = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>`;
            const lt = document.getElementById('labels-toggle'), lti = document.getElementById('labels-toggle-icon');
            lt.onclick = () => {
                showLabels = !showLabels;
                lti.innerHTML = showLabels ? EYE : EYE_OFF;
                lt.classList.toggle('text-slate-400', !showLabels);
                lt.classList.toggle('text-slate-600', showLabels);
            }
        }

        
        // ===== 多反应卡片切换 =====
        function disposeScene() {
            // 无条件清空标签层（即使 renderer 已为 null，也清掉残留标签）
            const _lo = document.getElementById('labels-overlay');
            if (_lo) _lo.innerHTML = '';
            if (renderer) {
                cancelAnimationFrame(playRAF); playRAF = null;
                cancelAnimationFrame(slideRAF); slideRAF = null;
                window.removeEventListener('resize', onResize);
                renderer.dispose();
                if (renderer.domElement && renderer.domElement.parentNode)
                    renderer.domElement.parentNode.removeChild(renderer.domElement);
                scene = null; renderer = null; controls = null;
                atoms = {}; fragments = {}; bondList.length = 0;
                electronSprites.length = 0;
                flameLight = null; flameSprite = null; transitionLight = null;
            }
        }
        function switchReaction(idx) {
            if (idx === curIdx && DATA) return;
            curIdx = idx; DATA = ALL[idx];
            META = DATA.meta; COND = DATA.conditions || {}; UI = DATA.ui || {};
            ACC = ACCENTS[META.accent] || ACCENTS.indigo;
            steps = DATA.steps || [];
            disposeScene();
            progress = 0; isPlaying = false;
            showFlame = true; showCatalyst = true;
            const _ft = document.getElementById('flame-toggle');
            if (_ft) _ft.checked = true;
            const _ct = document.getElementById('catalyst-toggle');
            if (_ct) _ct.checked = true;
            document.getElementById('reaction-slider').value = 0;
            document.getElementById('play-text').textContent = UI.play || '自动演示';
            // 重设 accent 变量（META/COND/UI 是 const，用重建函数内变量）
            applyAccent();
            paintStaticUI();
            const st = document.getElementById('stepper'); st.innerHTML = '';
            lastStep = -1;
            document.getElementById('explanation-text').innerHTML = '加载中...';
            buildStepper(); init3D(); buildLabels(); bindEvents();
            updateStep(0); lastStep = -1;
            if (typeof renderMathInElement === 'function') {
                renderMathInElement(document.body, { delimiters: [
                    { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });
            }
            // 高亮当前卡片
            document.querySelectorAll('#card-row > button').forEach((b, i) => {
                b.classList.toggle('card-active', i === idx);
                b.classList.toggle('card-idle', i !== idx);
            });
        }
        function applyAccent() {
            const m = ALL[curIdx].meta, u = ALL[curIdx].ui || {};
            const acc = ACCENTS[m.accent] || ACCENTS.indigo;
            document.documentElement.style.setProperty('--accent', acc);
            document.documentElement.style.setProperty('--accent-soft', hexToRgba(acc, 0.25));
        }
        function buildCards() {
            const row = document.getElementById('card-row');
            ALL.forEach((d, i) => {
                const b = document.createElement('button');
                b.className = 'card-idle px-3 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap';
                b.textContent = d.card || ('反应 ' + (i + 1));
                b.onclick = () => switchReaction(i);
                row.appendChild(b);
            });
        }
        function start() {
            buildCards();
            paintStaticUI(); buildStepper(); init3D(); buildLabels(); bindEvents();
            updateStep(0); lastStep = -1;
            animate();
            if (typeof renderMathInElement === 'function') {
                renderMathInElement(document.body, { delimiters: [
                    { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });
            }
        }
        function destroy() {
            destroyed = true;
            try { disposeScene(); } catch (e) { /* ignore */ }
        }
        return { start, destroy, switchReaction, get index() { return curIdx } };
    }
    window.ChemPlayer = { create };
})();
