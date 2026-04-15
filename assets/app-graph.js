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

    /**
     * Compute a short integer hash over sorted node ids and edge pairs.
     * Used as a sessionStorage cache key — identical topology → same hash.
     * @param {object[]} nodes
     * @param {object[]} edges
     * @param {number} width
     * @param {number} height
     * @returns {string}
     */
    function graphLayoutHash(nodes, edges, width, height) {
        const nodeStr = (nodes || []).map(n => String(n.id || '')).sort().join('|');
        const edgeStr = (edges || []).map(e => `${e.from || e.source}:${e.to || e.target}`).sort().join('|');
        const input = `${nodeStr}~~${edgeStr}~~${width}x${height}`;
        let h = 0x811c9dc5;
        for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = (Math.imul(h, 0x01000193) >>> 0);
        }
        return h.toString(16);
    }

    /**
     * Persist stable node positions to sessionStorage after a successful warmup.
     * @param {string} cacheKey
     * @param {object[]} nodes
     */
    function saveGraphLayoutCache(cacheKey, nodes) {
        try {
            const positions = {};
            for (const node of nodes) {
                if (node.id && node.x != null && node.y != null) {
                    positions[String(node.id)] = { x: node.x, y: node.y };
                }
            }
            sessionStorage.setItem(cacheKey, JSON.stringify(positions));
        } catch { /* sessionStorage may be full or unavailable — ignore */ }
    }

    /**
     * Load persisted node positions from sessionStorage.
     * @param {string} cacheKey
     * @returns {Object.<string, {x: number, y: number}>|null}
     */
    function loadGraphLayoutCache(cacheKey) {
        try {
            const raw = sessionStorage.getItem(cacheKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || parsed === null) return null;
            return parsed;
        } catch { return null; }
    }

    /**
     * Apply cached positions to nodes, bypassing force-simulation warmup.
     * Nodes not found in cache fall back to seedNodeLayout coordinates.
     * @param {object[]} nodes
     * @param {Object.<string, {x: number, y: number}>} cache
     */
    function restoreGraphLayoutFromCache(nodes, cache) {
        const uncached = [];
        for (const node of nodes) {
            const pos = cache[String(node.id || '')];
            if (pos && pos.x != null && pos.y != null) {
                node.x = pos.x;
                node.y = pos.y;
                node.fx = pos.x;
                node.fy = pos.y;
            } else {
                uncached.push(node);
            }
        }
        // Seed any new nodes that weren't in the cache using the existing layout helper
        if (uncached.length > 0) {
            const all = nodes;
            const width = (uncached[0].clusterX != null ? null : null) || 800;
            seedNodeLayout(uncached, width, 600);
        }
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

        // Cross-fade existing SVG out via CSS before replacing
        const prevSvg = container.querySelector('svg');
        if (prevSvg) {
            prevSvg.style.transition = 'opacity 0.18s ease';
            prevSvg.style.opacity = '0';
            await new Promise(r => setTimeout(r, 190));
        }

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
            let data;
            const S = window.MeshState;

            // When the client has a live tree scan, build locally — the server
            // may still hold a stale workspace from a different folder session.
            if (S?.tree?.length) {
                data = await buildLocalGraph();
            } else if (S?.dirName) {
                // Folder is open but tree not yet scanned (e.g. still restoring).
                // Only use server data if its folderName matches what we know is open.
                const wsId = S.workspaceId || '';
                const folderName = S.dirName;
                let graphUrl = '/api/assistant/workspace/graph';
                const params = new URLSearchParams();
                if (wsId) params.set('workspaceId', wsId);
                params.set('folderName', folderName);
                graphUrl += '?' + params.toString();
                try {
                    const resp = await fetch(graphUrl);
                    const remote = await resp.json();
                    if (!remote.ok) throw new Error(remote.error || 'No data');
                    // Reject if server returned data for a different folder
                    if (remote.folderName && remote.folderName !== folderName) {
                        data = { ok: true, nodes: [], edges: [], hasWorkspace: true };
                    } else {
                        data = remote;
                    }
                } catch {
                    data = await buildLocalGraph();
                }
            } else {
                // No folder open on the client — skip server fetch entirely.
                // Server RAM may hold a stale workspace from a previous session;
                // using it would show a phantom graph while the explorer shows "No Folder Opened".
                data = { ok: true, nodes: [], edges: [] };
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

            container.textContent = '';
            const width = container.clientWidth || 800;
            const height = container.clientHeight || 600;
            let showLabels = true;
            let showDirs = true;
            const visibleNodes = () => data.nodes.filter(d => showDirs || !d.isDirectory);

            // Layout cache key: hash of sorted node ids + edge topology + viewport size.
            // Lets us skip the force-simulation warmup on repeat visits to the graph view.
            const layoutCacheKey = 'mesh-graph-layout:' + graphLayoutHash(data.nodes, data.edges, width, height);
            const cachedLayout = loadGraphLayoutCache(layoutCacheKey);
            if (cachedLayout) {
                restoreGraphLayoutFromCache(data.nodes, cachedLayout);
            } else {
                seedNodeLayout(data.nodes, width, height);
            }

            const FILE_COLORS = {
                directory: '#e8a838',
                javascript: '#f7df1e',
                typescript: '#4fc3f7',
                html: '#ff7043',
                css: '#40c4ff',
                json: '#69f0ae',
                python: '#80cbc4',
                markdown: '#ce93d8',
                _default: '#b0bec5',
            };

            function getFileTypeColor(type) {
                const t = String(type || '').toLowerCase();
                for (const [key, color] of Object.entries(FILE_COLORS)) {
                    if (key !== '_default' && t.includes(key)) return color;
                }
                return FILE_COLORS._default;
            }

            function nodeRadius(d) { return d.isDirectory ? 10 : 7; }

            const svg = d3.select(container)
                .append('svg')
                .attr('width', '100%')
                .attr('height', '100%')
                .attr('viewBox', `0 0 ${width} ${height}`)
                .style('background', 'var(--bg)');

            const defs = svg.append('defs');

            defs.append('marker')
                .attr('id', 'arrowhead')
                .attr('viewBox', '-0 -4 8 8')
                .attr('refX', 22).attr('refY', 0)
                .attr('orient', 'auto')
                .attr('markerWidth', 5).attr('markerHeight', 5)
                .append('path')
                .attr('d', 'M 0,-4 L 8,0 L 0,4')
                .attr('fill', 'var(--tx3)')
                .style('stroke', 'none');

            const glowFilter = defs.append('filter').attr('id', 'glow').attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
            glowFilter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '1.8').attr('result', 'blur');
            const feMerge = glowFilter.append('feMerge');
            feMerge.append('feMergeNode').attr('in', 'SourceGraphic');
            feMerge.append('feMergeNode').attr('in', 'blur');

            const g = svg.append('g');
            const zoomBehavior = d3.zoom().scaleExtent([0.1, 5]).on('zoom', (event) => { g.attr('transform', event.transform); });
            svg.call(zoomBehavior);

            const simulation = d3.forceSimulation(data.nodes)
                .force('link', d3.forceLink(edges).id(d => d.id).distance((d) => {
                    const sameCluster = d.source?.clusterDir && d.source.clusterDir === d.target?.clusterDir;
                    return sameCluster ? 90 : 180;
                }).strength((d) => d.source?.clusterDir === d.target?.clusterDir ? 0.6 : 0.2))
                .force('charge', d3.forceManyBody().strength(-850).distanceMax(700))
                .force('center', d3.forceCenter(width / 2, height / 2))
                .force('collision', d3.forceCollide().radius((d) => (d.labelRadius || 40) + 8).iterations(3))
                .force('x', d3.forceX((d) => d.clusterX || (width / 2)).strength(0.14))
                .force('y', d3.forceY((d) => d.clusterY || (height / 2)).strength(0.14))
                .alphaDecay(0.06)
                .velocityDecay(0.42)
                .stop();

            if (!cachedLayout) {
                const warmupTicks = Math.min(500, Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())));
                for (let i = 0; i < warmupTicks; i++) simulation.tick();
                data.nodes.forEach(d => { d.fx = d.x; d.fy = d.y; });
                // Persist positions so the next visit skips simulation entirely
                saveGraphLayoutCache(layoutCacheKey, data.nodes);
            }

            const link = g.append('g').attr('class', 'links')
                .selectAll('path').data(edges).enter().append('path')
                .attr('fill', 'none')
                .attr('stroke', 'var(--tx3)')
                .attr('stroke-width', 0.9)
                .attr('stroke-opacity', 0.55)
                .attr('marker-end', 'url(#arrowhead)')
                .attr('d', d => {
                    const dx = d.target.x - d.source.x;
                    const dy = d.target.y - d.source.y;
                    const dr = Math.sqrt(dx * dx + dy * dy) * 1.2;
                    return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
                });

            const node = g.append('g').attr('class', 'nodes')
                .selectAll('g').data(data.nodes).enter().append('g')
                .attr('transform', d => `translate(${d.x},${d.y})`)
                .call(d3.drag()
                    .on('start', (event, d) => {
                        d.fx = null; d.fy = null;
                        if (!event.active) simulation.alphaTarget(0.1).restart();
                    })
                    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
                    .on('end', (event, d) => {
                        if (!event.active) simulation.alphaTarget(0);
                        d.fx = d.x; d.fy = d.y;
                    }));

            node.each(function(d) {
                const el = d3.select(this);
                const color = getFileTypeColor(d.fileType);
                if (d.isDirectory) {
                    el.append('rect')
                        .attr('x', -11).attr('y', -11)
                        .attr('width', 22).attr('height', 22)
                        .attr('rx', 5).attr('ry', 5)
                        .attr('fill', color)
                        .attr('fill-opacity', 0.18)
                        .attr('stroke', color)
                        .attr('stroke-width', 2);
                } else {
                    el.append('circle')
                        .attr('r', nodeRadius(d))
                        .attr('fill', color)
                        .attr('fill-opacity', 0.9)
                        .attr('stroke', color)
                        .attr('stroke-width', 1)
                        .style('filter', 'url(#glow)');
                }
            });

            const labels = node.append('text')
                .attr('dx', d => d.isDirectory ? 14 : 11)
                .attr('dy', '.35em')
                .text(d => {
                    const n = d.name || '';
                    return n.length > 22 ? n.slice(0, 20) + '…' : n;
                })
                .attr('fill', 'var(--tx2)')
                .style('font-size', d => d.isDirectory ? '11px' : '9.5px')
                .style('font-weight', d => d.isDirectory ? '600' : '400')
                .style('font-family', 'var(--f)')
                .style('pointer-events', 'none');

            node.append('title').text(d => d.path);

            node.on('click', (event, d) => { if (window.openFileByPath) window.openFileByPath(d.path); })
                .on('mouseover', function(event, d) {
                    d3.select(this).raise();
                    d3.select(this).select('circle, rect').transition().duration(150)
                        .attr('r', d.isDirectory ? undefined : nodeRadius(d) + 3)
                        .attr('stroke', 'var(--ac)').attr('stroke-width', 2.5);
                    link.attr('stroke-opacity', e =>
                        (e.source === d || e.target === d) ? 0.9 : 0.1
                    ).attr('stroke', e =>
                        (e.source === d || e.target === d) ? 'var(--ac)' : 'var(--tx3)'
                    ).attr('stroke-width', e =>
                        (e.source === d || e.target === d) ? 1.5 : 0.6
                    );
                })
                .on('mouseout', function(event, d) {
                    const c = getFileTypeColor(d.fileType);
                    d3.select(this).select('circle').transition().duration(200)
                        .attr('r', nodeRadius(d)).attr('stroke', c).attr('stroke-width', 1);
                    d3.select(this).select('rect').transition().duration(200)
                        .attr('stroke', c).attr('stroke-width', 2);
                    link.attr('stroke-opacity', 0.55).attr('stroke', 'var(--tx3)').attr('stroke-width', 0.9);
                });

            // Entrance animation: fade with per-node stagger — avoids anime.js v4 API incompatibilities
            node.style('opacity', '0').style('transition', 'opacity 0.4s ease');
            link.style('opacity', '0').style('transition', 'opacity 0.3s ease');

            // Apply stagger delays: groups of 8 nodes share a delay tier, 20ms between tiers
            node.nodes().forEach((el, i) => {
                el.style.transitionDelay = (Math.floor(i / 8) * 20) + 'ms';
            });

            requestAnimationFrame(() => {
                node.style('opacity', '1');
                setTimeout(() => {
                    link.style('opacity', '0.4');
                    // Remove stagger delays after animation so hover/drag transitions are instant
                    setTimeout(() => node.nodes().forEach(el => { el.style.transitionDelay = '0ms'; }), 700);
                }, 80);
            });

            simulation.on('tick', () => {
                link.attr('d', d => {
                    const dx = d.target.x - d.source.x;
                    const dy = d.target.y - d.source.y;
                    const dr = Math.sqrt(dx * dx + dy * dy) * 1.2;
                    return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
                });
                node.attr('transform', d => `translate(${d.x},${d.y})`);
            });

            /* ── Toolbar ── */
            const toolbar = document.createElement('div');
            toolbar.className = 'graph-toolbar';
            const makeBtn = (text, title, handler) => {
                const btn = document.createElement('button');
                btn.className = 'graph-tb-btn';
                btn.textContent = text;
                btn.title = title;
                btn.addEventListener('click', handler);
                return btn;
            };
            toolbar.appendChild(makeBtn('+', 'Zoom in', () => svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.4)));
            toolbar.appendChild(makeBtn('−', 'Zoom out', () => svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.7)));
            toolbar.appendChild(makeBtn('⟳', 'Reset view', () => svg.transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity)));
            toolbar.appendChild(makeBtn('Aa', 'Toggle labels', () => {
                showLabels = !showLabels;
                labels.style('display', showLabels ? null : 'none');
            }));
            toolbar.appendChild(makeBtn('▣', 'Toggle directories', () => {
                showDirs = !showDirs;
                node.style('display', d => (!showDirs && d.isDirectory) ? 'none' : null);
                link.style('display', d => {
                    if (!showDirs) {
                        const sId = typeof d.source === 'object' ? d.source.id : d.source;
                        const tId = typeof d.target === 'object' ? d.target.id : d.target;
                        if (String(sId).startsWith('dir:') || String(tId).startsWith('dir:')) return 'none';
                    }
                    return null;
                });
            }));
            container.appendChild(toolbar);

            /* ── Legend ── */
            const legend = document.createElement('div');
            legend.className = 'graph-legend';
            const legendTitle = document.createElement('div');
            legendTitle.className = 'graph-legend-title';
            legendTitle.textContent = 'Node Types';
            legend.appendChild(legendTitle);
            const legendItems = [
                ['Directory', FILE_COLORS.directory],
                ['JavaScript', FILE_COLORS.javascript],
                ['TypeScript', FILE_COLORS.typescript],
                ['HTML', FILE_COLORS.html],
                ['CSS', FILE_COLORS.css],
                ['JSON', FILE_COLORS.json],
                ['Python', FILE_COLORS.python],
                ['Other', FILE_COLORS._default],
            ];
            for (const [label, color] of legendItems) {
                const item = document.createElement('div');
                item.className = 'graph-legend-item';
                const chip = document.createElement('span');
                chip.className = 'graph-legend-chip';
                chip.style.cssText = `background:${color};box-shadow:0 0 5px ${color}88`;
                const text = document.createElement('span');
                text.textContent = label;
                item.append(chip, text);
                legend.appendChild(item);
            }
            container.appendChild(legend);

            /* ── Stats badge ── */
            const statsBadge = document.createElement('div');
            statsBadge.className = 'graph-stats';
            statsBadge.textContent = data.nodes.length + ' nodes · ' + edges.length + ' edges';
            container.appendChild(statsBadge);

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

    let _graphDebounceTimer = null;
    window.addEventListener('mesh-indexing-background-progress', () => {
        clearTimeout(_graphDebounceTimer);
        _graphDebounceTimer = setTimeout(refreshVisibleGraph, 1500);
    });
})();
