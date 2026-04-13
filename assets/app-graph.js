/* Mesh Workspace Mesh Graph (D3.js) */
(function() {
    const $ = (s, r = document) => r.querySelector(s);
    const GRAPH_EXCLUDED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.cache', 'coverage']);
    const GRAPH_EXCLUDED_FILES = /(^|\/)(\.DS_Store|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|cargo\.lock|\.mesh-worker-workspace-cache\.json)$/i;
    const GRAPH_PREFERRED_FILES = /(^|\/)(package\.json|README\.md|tsconfig(\.[^.]+)?\.json|vite\.config\.[^/]+|next\.config\.[^/]+|webpack\.config\.[^/]+|jest\.config\.[^/]+|tailwind\.config\.[^/]+|postcss\.config\.[^/]+|Dockerfile|docker-compose\.(ya?ml))$/i;

    function isGraphRelevantPath(path) {
        const normalized = normalizePath(path);
        if (!normalized) return false;
        if (GRAPH_EXCLUDED_FILES.test(normalized)) return false;
        if (isDependencySource(normalized)) return true;
        return GRAPH_PREFERRED_FILES.test(normalized);
    }

    function estimateNodeRadius(node) {
        const label = String(node?.name || node?.path || '');
        return 18 + Math.min(56, Math.round(label.length * 1.8));
    }

    function seedNodeLayout(nodes, width, height) {
        const dirGroups = new Map();
        for (const node of (nodes || [])) {
            const dir = dirname(node.path) || '.';
            if (!dirGroups.has(dir)) dirGroups.set(dir, []);
            dirGroups.get(dir).push(node);
        }

        const groups = [...dirGroups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
        const columns = Math.max(1, Math.ceil(Math.sqrt(groups.length || 1)));
        const rows = Math.max(1, Math.ceil(groups.length / columns));
        const cellWidth = width / (columns + 1);
        const cellHeight = height / (rows + 1);

        groups.forEach(([dir, members], index) => {
            const col = index % columns;
            const row = Math.floor(index / columns);
            const clusterX = cellWidth * (col + 1);
            const clusterY = cellHeight * (row + 1);
            const radiusBase = 34 + (Math.sqrt(members.length) * 22);
            members.forEach((node, memberIndex) => {
                const angle = (Math.PI * 2 * memberIndex) / Math.max(1, members.length);
                const ring = radiusBase + ((memberIndex % 4) * 14);
                node.clusterDir = dir;
                node.clusterX = clusterX;
                node.clusterY = clusterY;
                node.labelRadius = estimateNodeRadius(node);
                node.x = clusterX + (Math.cos(angle) * ring);
                node.y = clusterY + (Math.sin(angle) * ring * 0.72);
            });
        });
    }

    function mergeGraphData(primary, secondary) {
        const mergedNodes = new Map();
        const mergedEdges = new Set();

        for (const source of [primary, secondary]) {
            for (const node of (source?.nodes || [])) {
                const key = node.id || node.path || node.name;
                if (!key) continue;
                if (!mergedNodes.has(key)) mergedNodes.set(key, { ...node, id: key });
            }
            for (const edge of (source?.edges || [])) {
                if (!edge?.from || !edge?.to) continue;
                mergedEdges.add(`${edge.from}::${edge.to}`);
            }
        }

        return {
            ok: true,
            hasWorkspace: Boolean(primary?.hasWorkspace || secondary?.hasWorkspace),
            nodes: [...mergedNodes.values()],
            edges: [...mergedEdges].map((key) => {
                const [from, to] = key.split('::');
                return { from, to };
            }),
        };
    }

    /**
     * Build a dependency graph locally from the workspace file tree
     * when the remote Mesh Core worker is unreachable.
     * S.tree is a flat array of { name, path, isDir, children?, handle } items.
     */
    async function buildLocalGraph() {
        const S = window.MeshState;
        if (!S || !Array.isArray(S.tree) || S.tree.length === 0) {
            return { ok: true, nodes: [], edges: [] };
        }

        const flat = [];
        const dirNodes = [];
        const walk = (items) => {
            for (const item of items) {
                if (item.isDir) {
                    const normalizedDir = normalizePath(item.path);
                    if (normalizedDir && !GRAPH_EXCLUDED_DIRS.has(item.name) && normalizedDir !== '.mesh') {
                        dirNodes.push({
                            id: `dir:${normalizedDir}`,
                            name: item.name || normalizedDir,
                            path: normalizedDir,
                            fileType: 'directory',
                            isDirectory: true,
                        });
                    }
                    if (!GRAPH_EXCLUDED_DIRS.has(item.name)) walk(item.children || []);
                } else {
                    if (!isGraphRelevantPath(item.path)) continue;
                    flat.push({ id: item.path, name: item.name || item.path.split('/').pop(), path: item.path, fileType: extToType(item.path) });
                }
            }
        };
        walk(S.tree);

        if (flat.length === 0) return { ok: true, nodes: [], edges: [] };

        /* Cap nodes and build a lookup set so edges only reference included nodes */
        flat.sort((a, b) => {
            const scoreA = (isDependencySource(a.path) ? 4 : 0) + (GRAPH_PREFERRED_FILES.test(a.path) ? 2 : 0);
            const scoreB = (isDependencySource(b.path) ? 4 : 0) + (GRAPH_PREFERRED_FILES.test(b.path) ? 2 : 0);
            if (scoreA !== scoreB) return scoreB - scoreA;
            return a.path.localeCompare(b.path);
        });
        const fileNodes = flat.slice(0, 450);
        const includedDirs = new Map();
        for (const node of fileNodes) {
            let currentDir = dirname(node.path);
            while (currentDir) {
                const dirId = `dir:${currentDir}`;
                if (!includedDirs.has(dirId)) {
                    const dirName = currentDir.split('/').pop() || currentDir;
                    includedDirs.set(dirId, {
                        id: dirId,
                        name: dirName,
                        path: currentDir,
                        fileType: 'directory',
                        isDirectory: true,
                    });
                }
                currentDir = dirname(currentDir);
            }
        }
        const nodes = [...includedDirs.values(), ...fileNodes];
        const nodeIds = new Set(nodes.map(n => n.id));
        const pathToNode = new Map(nodes.map(n => [normalizePath(n.path), n]));
        const candidatePaths = new Set(pathToNode.keys());
        const edgeSeen = new Set();
        const edges = [];

        for (const node of nodes) {
            const sourceItem = findTreeItemByPath(S.tree, node.path);
            if (!sourceItem?.handle || !isDependencySource(node.path)) continue;

            let content = '';
            try {
                const file = await sourceItem.handle.getFile();
                if ((file.size || 0) > 300000) continue;
                content = await file.text();
            } catch {
                continue;
            }

            const specifiers = extractDependencySpecifiers(node.path, content);
            for (const specifier of specifiers) {
                const resolvedPath = resolveImportSpecifier(node.path, specifier, candidatePaths);
                if (!resolvedPath) continue;
                const targetNode = pathToNode.get(resolvedPath);
                if (!targetNode || !nodeIds.has(targetNode.id) || targetNode.id === node.id) continue;
                const key = `${node.id}::${targetNode.id}`;
                if (edgeSeen.has(key)) continue;
                edgeSeen.add(key);
                edges.push({ from: node.id, to: targetNode.id });
                if (edges.length >= 3000) break;
            }
            if (edges.length >= 3000) break;
        }

        /* ── Structural edges: connect files that belong together ── */
        const connectedNodes = new Set();
        for (const e of edges) { connectedNodes.add(e.from); connectedNodes.add(e.to); }

        const CONFIG_FILES = new Set(['package.json', 'tsconfig.json', 'tsconfig.base.json', '.eslintrc.json', '.eslintrc.js', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs', 'webpack.config.js', 'jest.config.js', 'jest.config.ts', 'tailwind.config.js', 'tailwind.config.ts', 'postcss.config.js', '.prettierrc', '.prettierrc.js', 'Makefile', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']);

        /* Group nodes by directory */
        const dirGroups = new Map();
        for (const node of nodes) {
            const dir = normalizePath(node.path).replace(/\/[^/]+$/, '') || '.';
            if (!dirGroups.has(dir)) dirGroups.set(dir, []);
            dirGroups.get(dir).push(node);
        }

        function addStructuralEdge(fromId, toId) {
            if (fromId === toId) return;
            const key = `${fromId}::${toId}`;
            const revKey = `${toId}::${fromId}`;
            if (edgeSeen.has(key) || edgeSeen.has(revKey)) return;
            edgeSeen.add(key);
            edges.push({ from: fromId, to: toId });
        }

        /* 1) Config files connect to all source files in the same directory */
        for (const [dir, group] of dirGroups) {
            const configs = group.filter(n => CONFIG_FILES.has(n.name));
            const sources = group.filter(n => !CONFIG_FILES.has(n.name) && isDependencySource(n.path));
            for (const cfg of configs) {
                for (const src of sources.slice(0, 12)) {
                    addStructuralEdge(cfg.id, src.id);
                }
            }
        }

        /* 2) Name-based affinity: foo.ts <-> foo.test.ts, foo.css, foo.module.css */
        const baseNameMap = new Map();
        for (const node of nodes) {
            if (node.isDirectory) continue;
            const base = normalizePath(node.name)
                .replace(/\.(test|spec|stories|story|module|d)(\.[^.]+)?$/, '')
                .replace(/\.[^.]+$/, '');
            const dir = normalizePath(node.path).replace(/\/[^/]+$/, '') || '.';
            const groupKey = dir + '/' + base;
            if (!baseNameMap.has(groupKey)) baseNameMap.set(groupKey, []);
            baseNameMap.get(groupKey).push(node);
        }
        for (const [, group] of baseNameMap) {
            if (group.length < 2 || group.length > 6) continue;
            const anchor = group[0];
            for (let i = 1; i < group.length; i++) {
                addStructuralEdge(anchor.id, group[i].id);
            }
        }

        /* 3) Directory siblings: lightly connect disconnected files to a neighbor in the same folder */
        for (const [, group] of dirGroups) {
            if (group.length < 2) continue;
            const disconnected = group.filter(n => !connectedNodes.has(n.id));
            const connected = group.filter(n => connectedNodes.has(n.id));
            for (const orphan of disconnected) {
                const target = connected.length > 0
                    ? connected[Math.floor(Math.random() * connected.length)]
                    : group.find(n => n.id !== orphan.id);
                if (target) addStructuralEdge(orphan.id, target.id);
            }
        }

        /* 4) Cross-directory: connect index/main entry files to parent directory index */
        const ENTRY_NAMES = new Set(['index.js', 'index.ts', 'index.tsx', 'index.jsx', 'main.js', 'main.ts', 'mod.ts', 'index.css', 'index.html']);
        for (const node of nodes) {
            if (node.isDirectory) continue;
            if (!ENTRY_NAMES.has(node.name)) continue;
            const dir = normalizePath(node.path).replace(/\/[^/]+$/, '') || '.';
            const parentDir = dir.replace(/\/[^/]+$/, '') || '.';
            if (parentDir === dir) continue;
            const parentGroup = dirGroups.get(parentDir) || [];
            const parentEntry = parentGroup.find(n => ENTRY_NAMES.has(n.name));
            if (parentEntry) addStructuralEdge(parentEntry.id, node.id);
        }

        for (const node of fileNodes) {
            const dir = dirname(node.path);
            if (!dir) continue;
            const dirId = `dir:${dir}`;
            if (nodeIds.has(dirId)) addStructuralEdge(dirId, node.id);
        }

        for (const dirNode of includedDirs.values()) {
            const parentDir = dirname(dirNode.path);
            if (!parentDir) continue;
            const parentId = `dir:${parentDir}`;
            if (nodeIds.has(parentId)) addStructuralEdge(parentId, dirNode.id);
        }

        return { ok: true, nodes, edges };
    }

    function normalizePath(path) {
        return String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
    }

    function dirname(path) {
        const normalized = normalizePath(path);
        const idx = normalized.lastIndexOf('/');
        return idx === -1 ? '' : normalized.slice(0, idx);
    }

    function joinPath(base, segment) {
        const parts = `${base ? base + '/' : ''}${segment}`.split('/');
        const out = [];
        for (const part of parts) {
            if (!part || part === '.') continue;
            if (part === '..') out.pop();
            else out.push(part);
        }
        return out.join('/');
    }

    function isDependencySource(path) {
        const ext = (path.split('.').pop() || '').toLowerCase();
        return ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sass', 'less', 'html', 'htm'].includes(ext);
    }

    function findTreeItemByPath(items, targetPath) {
        for (const item of (items || [])) {
            if (item.path === targetPath) return item;
            if (item.isDir && item.children?.length) {
                const found = findTreeItemByPath(item.children, targetPath);
                if (found) return found;
            }
        }
        return null;
    }

    function extractDependencySpecifiers(path, content) {
        const ext = (path.split('.').pop() || '').toLowerCase();
        const found = new Set();
        const patterns = [
            /\bimport\s+(?:[^'"]+?\s+from\s+)?["']([^"']+)["']/g,
            /\bexport\s+[^'"]*?\s+from\s+["']([^"']+)["']/g,
            /\brequire\(\s*["']([^"']+)["']\s*\)/g,
            /\bimport\(\s*["']([^"']+)["']\s*\)/g,
        ];

        if (['css', 'scss', 'sass', 'less'].includes(ext)) {
            patterns.push(/@import\s+(?:url\()?["']([^"']+)["']\)?/g);
        }

        if (['html', 'htm'].includes(ext)) {
            patterns.push(/<(?:script|img|source)\b[^>]*\bsrc=["']([^"']+)["']/gi);
            patterns.push(/<link\b[^>]*\bhref=["']([^"']+)["']/gi);
        }

        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content))) {
                const specifier = String(match[1] || '').trim();
                if (specifier.startsWith('.') || specifier.startsWith('/')) {
                    found.add(specifier);
                }
            }
        }

        return [...found];
    }

    function resolveImportSpecifier(fromPath, specifier, candidatePaths) {
        if (!specifier) return '';
        const normalizedSpecifier = normalizePath(specifier);
        const sourceDir = dirname(fromPath);
        const rawTarget = normalizedSpecifier.startsWith('/')
            ? normalizedSpecifier.replace(/^\/+/, '')
            : joinPath(sourceDir, normalizedSpecifier);
        const ext = rawTarget.includes('.') ? rawTarget.slice(rawTarget.lastIndexOf('.')).toLowerCase() : '';
        const candidates = [
            rawTarget,
            ext ? rawTarget.slice(0, rawTarget.length - ext.length) : rawTarget,
        ];
        const suffixes = ['', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.sass', '.less', '.html', '.htm', '/index.js', '/index.ts', '/index.tsx', '/index.jsx', '/index.css', '/index.html'];

        for (const base of candidates) {
            for (const suffix of suffixes) {
                const candidate = normalizePath(base + suffix);
                if (candidatePaths.has(candidate)) return candidate;
            }
        }

        return candidatePaths.has(normalizePath(rawTarget)) ? normalizePath(rawTarget) : '';
    }

    function extToType(path) {
        const ext = (path.split('.').pop() || '').toLowerCase();
        const map = { js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript', html: 'html', css: 'css', json: 'json', py: 'python', md: 'markdown' };
        return map[ext] || ext;
    }

    let lottieAnim = null;
    window.initWorkspaceGraph = async function(containerId) {
        const container = $('#' + containerId);
        if (!container) return;

        if (lottieAnim) { lottieAnim.destroy(); lottieAnim = null; }
        container.innerHTML = `
            <div class="graph-loading">
                <div id="graphLoaderAnim" class="graph-loader-anim"></div>
                <div class="graph-loader-text" id="graphLoaderText">Analyzing Mesh Network...</div>
            </div>`;

        if (window.lottie) {
            lottieAnim = window.lottie.loadAnimation({
                container: $('#graphLoaderAnim', container),
                renderer: 'svg',
                loop: true,
                autoplay: true,
                path: '/assets/animations/mesh-loader-neon.json'
            });
        }

        const checkIndexing = () => {
            const idxWrap = $('#idxProgWrap');
            const idxTxt = $('#idxProgText');
            const state = window.MeshState?.workspaceIndex;
            if (state?.backgroundIndexRunning) return true;
            if (!idxWrap || idxWrap.style.display === 'none') return false;
            if (idxTxt && /(Initial index ready|Index complete|Graph updated|abgeschlossen)/i.test(idxTxt.textContent)) return false;
            return true;
        };

        try {
            /* Prefer the indexed server graph so dependency data can update incrementally.
               Do NOT send a synthetic workspaceId — the worker owns its workspace identity.
               Passing a client-constructed ID (dirName+userId) causes the worker's store
               lookup to win over RAM state and return an empty graph even when a folder
               is open (the synthetic key never matches what's in the store). */
            let data;
            const S = window.MeshState;
            try {
                const resp = await fetch('/api/assistant/workspace/graph');
                data = await resp.json();
                if (!data.ok) throw new Error(data.error || 'No data');
            } catch {
                data = await buildLocalGraph();
            }

            if (S?.tree?.length) {
                try {
                    const localData = await buildLocalGraph();
                    if (Array.isArray(localData?.nodes) && localData.nodes.length > 0) {
                        data = mergeGraphData(data, localData);
                    }
                } catch {
                    // Keep current graph data when local merge cannot improve it.
                }
            }

            const edges = (data.edges || []).map(e => ({ source: e.from, target: e.to }));

            if (data.nodes.length === 0) {
                // Distinguish "workspace open but still indexing" from "no folder open at all".
                // The server signals hasWorkspace=true when a workspace is loaded in RAM.
                // S.dirName is a secondary client-side signal for freshly opened folders.
                const folderIsOpen = Boolean(data.hasWorkspace) || Boolean(S?.dirName);
                if (folderIsOpen || checkIndexing()) {
                    const txt = $('#graphLoaderText', container);
                    if (txt) txt.textContent = folderIsOpen
                        ? 'Workspace detected, refining dependency data...'
                        : 'Indexing / refining dependencies...';
                    return;
                }
                container.innerHTML = '<div class="graph-loading"><div class="graph-loader-text">Open a folder to see the dependency graph.</div></div>';
                return;
            }

            container.innerHTML = '';
            const width = container.clientWidth || 800;
            const height = container.clientHeight || 600;
            seedNodeLayout(data.nodes, width, height);

            const svg = d3.select(container)
                .append('svg')
                .attr('width', '100%')
                .attr('height', '100%')
                .attr('viewBox', `0 0 ${width} ${height}`);

            const g = svg.append('g');
            svg.call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', (event) => { g.attr('transform', event.transform); }));

            /* Build simulation but do NOT start the live animation yet.
               Pre-run synchronously so nodes begin at stable positions. */
            const simulation = d3.forceSimulation(data.nodes)
                .force('link', d3.forceLink(edges).id(d => d.id).distance((d) => {
                    const sameCluster = d.source?.clusterDir && d.source.clusterDir === d.target?.clusterDir;
                    return sameCluster ? 110 : 165;
                }).strength((d) => d.source?.clusterDir === d.target?.clusterDir ? 0.55 : 0.28))
                .force('charge', d3.forceManyBody().strength(-720).distanceMax(620))
                .force('center', d3.forceCenter(width / 2, height / 2))
                .force('collision', d3.forceCollide().radius((d) => d.labelRadius || 34).iterations(2))
                .force('x', d3.forceX((d) => d.clusterX || (width / 2)).strength(0.12))
                .force('y', d3.forceY((d) => d.clusterY || (height / 2)).strength(0.12))
                .alphaDecay(0.08)
                .velocityDecay(0.45)
                .stop(); // stop before ticking so we control it

            /* Warm-up: run synchronously until stable (max 300 ticks) */
            const warmupTicks = Math.min(420, Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())));
            for (let i = 0; i < warmupTicks; i++) simulation.tick();

            /* Pin every node at its settled position so the graph is static by default */
            data.nodes.forEach(d => { d.fx = d.x; d.fy = d.y; });

            svg.append('defs').append('marker')
                .attr('id', 'arrowhead')
                .attr('viewBox', '-0 -5 10 10')
                .attr('refX', 20).attr('refY', 0)
                .attr('orient', 'auto')
                .attr('markerWidth', 6).attr('markerHeight', 6)
                .attr('xoverflow', 'visible')
                .append('svg:path')
                .attr('d', 'M 0,-5 L 10,0 L 0,5')
                .attr('fill', 'var(--ac)')
                .style('stroke', 'none');

            const link = g.append('g').attr('class', 'links')
                .selectAll('line').data(edges).enter().append('line')
                .attr('stroke', 'var(--bd)').attr('stroke-width', 1)
                .attr('marker-end', 'url(#arrowhead)')
                /* Render immediately at stable positions */
                .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x).attr('y2', d => d.target.y);

            const node = g.append('g').attr('class', 'nodes')
                .selectAll('g').data(data.nodes).enter().append('g')
                /* Render immediately at stable positions */
                .attr('transform', d => `translate(${d.x},${d.y})`)
                .call(d3.drag()
                    .on('start', (event, d) => {
                        /* Unpin only the dragged node so it moves freely */
                        d.fx = null; d.fy = null;
                        if (!event.active) simulation.alphaTarget(0.1).restart();
                    })
                    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
                    .on('end', (event, d) => {
                        if (!event.active) simulation.alphaTarget(0);
                        /* Re-pin at dropped position so it stays put */
                        d.fx = d.x; d.fy = d.y;
                    }));

            node.append('circle').attr('r', 8)
                .attr('fill', d => getFileTypeColor(d.fileType))
                .attr('stroke', 'var(--bg)').attr('stroke-width', 2);

            node.append('text').attr('dx', 12).attr('dy', '.35em')
                .text(d => d.name)
                .attr('fill', 'var(--tx1)').style('font-size', '10px').style('pointer-events', 'none');

            node.append('title').text(d => d.path);
            node.on('click', (event, d) => { if (window.openFileByPath) window.openFileByPath(d.path); });

            /* Live tick only updates the small subset of unpinned nodes during drag */
            simulation.on('tick', () => {
                link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
                node.attr('transform', d => `translate(${d.x},${d.y})`);
            });

            function getFileTypeColor(type) {
                if (String(type || '').includes('directory')) return '#8b8f9b';
                if (type.includes('javascript') || type.includes('typescript')) return 'var(--ac)';
                if (type.includes('html')) return '#e44d26';
                if (type.includes('css')) return '#264de4';
                if (type.includes('json')) return '#a5a500';
                if (type.includes('python')) return '#3572a5';
                return '#858585';
            }

        } catch (err) {
            container.textContent = '';
            const errDiv = document.createElement('div');
            errDiv.className = 'graph-error';
            errDiv.textContent = 'Mesh Graph Error: ' + (err.message || 'Unknown error');
            container.appendChild(errDiv);
        }
    };

    const refreshVisibleGraph = () => {
        if ($('#graphView')?.style.display === 'block') {
            window.initWorkspaceGraph('graphView');
        }
    };

    window.addEventListener('mesh-indexing-initial-ready', refreshVisibleGraph);
    window.addEventListener('mesh-indexing-complete', refreshVisibleGraph);
})();
