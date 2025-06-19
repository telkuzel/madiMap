class MultiFloorGraph {
    constructor() {
        this.floors = new Map();
        this.stairConnections = new Map();
        this.stairCoordinates = new Map();
        this.tolerance = 5;
    }

    addFloor(floorId, svgContent) {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");
        const svg = svgDoc.documentElement;

        const { graph, walls } = this.parseLinesToGraph(svg);
        const stairs = this.extractStairs(graph);

        if (!this.validateStairs(floorId, stairs)) {
            throw new Error(`Несовпадение координат лестниц на этаже ${floorId}`);
        }

        const texts = svg.querySelectorAll("text");
        texts.forEach(text => {
            const fill = text.getAttribute("fill")?.toLowerCase();
            if (fill !== "#ff0000" && fill !== "red") {
                text.remove();
            }
        });

        this.floors.set(floorId, { graph, svgContent: svg.outerHTML, stairs, walls });
        this.updateStairConnections(floorId, stairs);
    }

    parseLinesToGraph(svg) {
        const graph = new Graph();
        const points = new Map();
        const walls = [];

        const lines = Array.from(svg.querySelectorAll("line"));
        const texts = Array.from(svg.querySelectorAll("text"));

        lines.forEach(line => {
            const x1 = parseFloat(line.getAttribute("x1")) || 0;
            const y1 = parseFloat(line.getAttribute("y1")) || 0;
            const x2 = parseFloat(line.getAttribute("x2")) || 0;
            const y2 = parseFloat(line.getAttribute("y2")) || 0;
            const stroke = line.getAttribute("stroke")?.toLowerCase();

            if (stroke === "red" || stroke === "#ff0000") {
                walls.push({ x1, y1, x2, y2 });
            } else {
                this.registerPoint(points, graph, x1, y1);
                this.registerPoint(points, graph, x2, y2);

                const a = this.findPointId(points, x1, y1);
                const b = this.findPointId(points, x2, y2);
                if (a && b) graph.addEdge(a, b);
            }
        });

        texts.forEach(text => {
            const fill = text.getAttribute("fill")?.toLowerCase();
            if (fill === "#ff0000" || fill === "red") return;

            const tspan = text.querySelector('tspan');
            if (!tspan) return;

            const x = parseFloat(tspan.getAttribute("x")) || 0;
            const y = parseFloat(tspan.getAttribute("y")) || 0;
            const name = tspan.textContent.trim();

            let closest = null, minDist = Infinity;
            graph.nodes.forEach(n => {
                if (n.edges.length === 1) {
                    const d = Math.hypot(n.x - x, n.y - y);
                    if (d < 10 && d < minDist) {
                        minDist = d;
                        closest = n;
                    }
                }
            });

            if (closest) {
                closest.name = name;
            }
        });

        return { graph, walls };
    }

    validateStairs(floorId, stairs) {
        for (const stair of stairs) {
            if (!this.stairCoordinates.has(stair.name)) {
                this.stairCoordinates.set(stair.name, { x: stair.x, y: stair.y });
            } else {
                const expected = this.stairCoordinates.get(stair.name);
                if (Math.hypot(expected.x - stair.x, expected.y - stair.y) > this.tolerance) {
                    return false;
                }
            }
        }
        return true;
    }

    registerPoint(points, graph, x, y) {
        let foundKey = null;
        for (const [key, id] of points) {
            const [px, py] = key.split(',').map(parseFloat);
            if (Math.hypot(px - x, py - y) <= this.tolerance) {
                foundKey = key;
                break;
            }
        }

        if (!foundKey) {
            const key = `${x.toFixed(2)},${y.toFixed(2)}`;
            const id = `N${points.size + 1}`;
            points.set(key, id);
            graph.addNode(id, x, y);
        }
    }

    findPointId(points, x, y) {
        for (const [key, id] of points) {
            const [px, py] = key.split(',').map(parseFloat);
            if (Math.hypot(px - x, py - y) <= this.tolerance) {
                return id;
            }
        }
        return null;
    }

    extractStairs(graph) {
        return Array.from(graph.nodes.values())
            .filter(node => node.name?.startsWith('L'));
    }

    updateStairConnections(floorId, stairs) {
        stairs.forEach(stair => {
            if (!this.stairConnections.has(stair.name)) {
                this.stairConnections.set(stair.name, new Map());
            }
            this.stairConnections.get(stair.name).set(floorId, stair.id);
        });
    }

    findPathMultiFloor(startFloorId, startId, endFloorId, endId) {
        const visited = new Set();
        const queue = [{
            floor: startFloorId,
            node: startId,
            path: [{ floor: startFloorId, node: startId }],
            stairs: []
        }];

        while (queue.length > 0) {
            const current = queue.shift();
            const key = `${current.floor}|${current.node}`;
            if (visited.has(key)) continue;
            visited.add(key);

            if (current.floor === endFloorId && current.node === endId) {
                return {
                    path: current.path,
                    stairs: current.stairs
                };
            }

            const currentFloor = this.floors.get(current.floor);
            if (!currentFloor) continue;

            const currentNode = currentFloor.graph.nodes.get(current.node);
            if (!currentNode) continue;

            for (const neighbor of currentNode.edges) {
                if (!visited.has(`${current.floor}|${neighbor}`)) {
                    queue.push({
                        floor: current.floor,
                        node: neighbor,
                        path: [...current.path, { floor: current.floor, node: neighbor }],
                        stairs: [...current.stairs]
                    });
                }
            }

            if (currentNode.name?.startsWith('L')) {
                const connectedFloors = this.stairConnections.get(currentNode.name);
                if (connectedFloors) {
                    for (const [floorId, stairId] of connectedFloors) {
                        if (floorId !== current.floor && !visited.has(`${floorId}|${stairId}`)) {
                            queue.push({
                                floor: floorId,
                                node: stairId,
                                path: [...current.path, { floor: floorId, node: stairId }],
                                stairs: [...current.stairs, currentNode.name]
                            });
                        }
                    }
                }
            }
        }
        return null;
    }

    getAllNodes() {
        const allNodes = [];
        for (const [floorId, floorData] of this.floors) {
            floorData.graph.nodes.forEach(node => {
                allNodes.push({
                    ...node,
                    floor: floorId
                });
            });
        }
        return allNodes;
    }

    getStartNode() {
        for (const [floorId, floorData] of this.floors) {
            for (const node of floorData.graph.nodes.values()) {
                if (node.name === "0") {
                    return { floor: floorId, id: node.id };
                }
            }
        }
        return null;
    }
}

class Graph {
    constructor() {
        this.nodes = new Map();
        this.edges = [];
    }

    addNode(id, x, y) {
        this.nodes.set(id, { id, x, y, edges: [], name: null });
    }

    addEdge(a, b) {
        if (a && b && a !== b) {
            this.edges.push({ source: a, target: b });
            this.nodes.get(a).edges.push(b);
            this.nodes.get(b).edges.push(a);
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const multiGraph = new MultiFloorGraph();
    const svgContainer = document.getElementById("svgContainer");
    const floorButtons = document.getElementById("floorButtons");
    const endSel = document.getElementById("endNode");
    const searchInput = document.getElementById("searchNode");
    const findBtn = document.getElementById("find-btn");
    const resetBtn = document.getElementById("resetBtn");
    const currentFloorSpan = document.getElementById("currentFloor");
    const selectedNodeSpan = document.getElementById("selectedNode");
    const pathRes = document.getElementById("pathResult");
    const stairsUsed = document.getElementById("stairsUsed");
    const nextFloorSpan = document.getElementById("nextFloor");
    const errorMsg = document.getElementById("errorMsg");
    
    const zoomInBtn = document.getElementById("zoomInBtn");
    const zoomOutBtn = document.getElementById("zoomOutBtn");

    let allNodes = [];

    // Zoom handling function
    function handleZoom(svg, scaleFactor, clientX, clientY) {
        if (!svg || !svg._viewBox) return;

        const MIN_ZOOM = 0.3;
        const MAX_ZOOM = 8;

        const rect = svg.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;

        const { x: vx, y: vy, w: vw, h: vh, originalWidth } = svg._viewBox;

        const newWidth = vw * scaleFactor;
        if (newWidth < originalWidth * MIN_ZOOM || newWidth > originalWidth * MAX_ZOOM) {
            return;
        }

        const viewBoxX = mouseX * vw / rect.width + vx;
        const viewBoxY = mouseY * vh / rect.height + vy;

        const newViewBoxWidth = newWidth;
        const newViewBoxHeight = newWidth * (svg._viewBox.originalHeight / svg._viewBox.originalWidth);
        const dx = (viewBoxX - vx) * (1 - scaleFactor);
        const dy = (viewBoxY - vy) * (1 - scaleFactor);

        svg._viewBox.x += dx;
        svg._viewBox.y += dy;
        svg._viewBox.w = newViewBoxWidth;
        svg._viewBox.h = newViewBoxHeight;

        svg.setAttribute("viewBox", `${svg._viewBox.x} ${svg._viewBox.y} ${svg._viewBox.w} ${svg._viewBox.h}`);
    }

    let currentFloorId = null;
    let lastPathResult = null;

    function showFloor(floorId) {
        const floor = multiGraph.floors.get(floorId);
        if (!floor) return;

        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(floor.svgContent, "image/svg+xml");
        const svg = svgDoc.documentElement;

        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.display = 'block';

        svgContainer.innerHTML = '';
        svgContainer.appendChild(svg);

        visualizeGraph(svg, floor.graph, floor.walls);
        centerSVG(svg);
        enablePanAndZoom(svg);
        currentFloorId = floorId;
        currentFloorSpan.textContent = floorId;
        selectedNodeSpan.textContent = '';
        nextFloorSpan.textContent = '';

        // Подсветка текущего этажа зеленым
        document.querySelectorAll('.floor-btn').forEach(btn => {
            btn.classList.remove('current-floor', 'highlight');
            if (btn.textContent === floorId) {
                btn.classList.add('current-floor');
            }
        });

        if (lastPathResult) {
            visualizePath(svg, lastPathResult.path, floorId);
            updateNextFloorMessage(floorId, lastPathResult.path);
        }
    }

    function visualizeGraph(svg, graph, walls) {
        svg.querySelectorAll('.node-vis, .edge-vis, .wall-vis').forEach(el => el.remove());

        walls.forEach(wall => {
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", wall.x1);
            line.setAttribute("y1", wall.y1);
            line.setAttribute("x2", wall.x2);
            line.setAttribute("y2", wall.y2);
            line.setAttribute("class", "wall wall-vis");
            svg.appendChild(line);
        });

        graph.edges.forEach(({ source, target }) => {
            const a = graph.nodes.get(source);
            const b = graph.nodes.get(target);
            if (!a || !b) return;

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", a.x);
            line.setAttribute("y1", a.y);
            line.setAttribute("x2", b.x);
            line.setAttribute("y2", b.y);
            line.setAttribute("class", "edge edge-vis");
            svg.appendChild(line);
        });

        graph.nodes.forEach(node => {
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", node.x);
            circle.setAttribute("cy", node.y);
            circle.setAttribute("r", node.edges.length > 1 ? "2" : "5");
            circle.setAttribute("fill", node.name === "0" ? "#FF0000" : (node.edges.length > 1 ? "#000000" : (node.name?.startsWith('L') ? "#FF9800" : "#4CAF50")));
            circle.setAttribute("stroke", "#333");
            circle.setAttribute("stroke-width", "2");
            circle.setAttribute("class", `node ${node.name?.startsWith('L') ? 'stair' : ''} node-vis`);
            circle.setAttribute("data-node-id", node.id);
            circle.addEventListener("click", () => {
                selectedNodeSpan.textContent = node.name || node.id;
            });
            svg.appendChild(circle);
        });
    }

    function centerSVG(svg) {
        let viewBoxAttr = svg.getAttribute('viewBox');
        if (!viewBoxAttr) {
            const lines = svg.querySelectorAll('line');
            const circles = svg.querySelectorAll('circle');
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            lines.forEach(line => {
                const x1 = parseFloat(line.getAttribute('x1')) || 0;
                const y1 = parseFloat(line.getAttribute('y1')) || 0;
                const x2 = parseFloat(line.getAttribute('x2')) || 0;
                const y2 = parseFloat(line.getAttribute('y2')) || 0;
                minX = Math.min(minX, x1, x2);
                minY = Math.min(minY, y1, y2);
                maxX = Math.max(maxX, x1, x2);
                maxY = Math.max(maxY, y1, y2);
            });

            circles.forEach(circle => {
                const cx = parseFloat(circle.getAttribute('cx')) || 0;
                const cy = parseFloat(circle.getAttribute('cy')) || 0;
                const r = parseFloat(circle.getAttribute('r')) || 0;
                minX = Math.min(minX, cx - r);
                minY = Math.min(minY, cy - r);
                maxX = Math.max(maxX, cx + r);
                maxY = Math.max(maxY, cy + r);
            });

            if (minX === Infinity) {
                minX = minY = 0;
                maxX = maxY = 1000;
            }

            viewBoxAttr = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
            svg.setAttribute('viewBox', viewBoxAttr);
        }

        const [x, y, width, height] = viewBoxAttr.split(' ').map(parseFloat);
        const padding = 20;

        const newViewBox = `${x - padding} ${y - padding} ${width + 2 * padding} ${height + 2 * padding}`;
        svg.setAttribute('viewBox', newViewBox);

        svg._viewBox = {
            x: x - padding,
            y: y - padding,
            w: width + 2 * padding,
            h: height + 2 * padding,
            originalWidth: width,
            originalHeight: height
        };
    }

    function visualizePath(svg, path, currentFloor, delay = 500) {
        svg.querySelectorAll('.path').forEach(el => el.remove());

        let i = 0;
        function drawNextSegment() {
            if (i >= path.length - 1) return;

            const current = path[i];
            const next = path[i + 1];

            if (current.floor === currentFloor && current.floor === next.floor) {
                const floorData = multiGraph.floors.get(current.floor);
                const node1 = floorData.graph.nodes.get(current.node);
                const node2 = floorData.graph.nodes.get(next.node);

                if (node1 && node2) {
                    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                    line.setAttribute("x1", node1.x);
                    line.setAttribute("y1", node1.y);
                    line.setAttribute("x2", node2.x);
                    line.setAttribute("y2", node2.y);
                    line.setAttribute("class", "path");
                    svg.appendChild(line);
                }
            }

            i++;
            setTimeout(drawNextSegment, delay);
        }

        drawNextSegment();
    }

    function enablePanAndZoom(svg) {
        const viewBox = svg.getAttribute("viewBox").split(" ").map(parseFloat);
        svg._viewBox = {
            x: viewBox[0],
            y: viewBox[1],
            w: viewBox[2],
            h: viewBox[3],
            originalWidth: viewBox[2],
            originalHeight: viewBox[3]
        };

        const minZoom = 0.3;
        const maxZoom = 8.0;

        let isPanning = false;
        let startPoint = { x: 0, y: 0 };

        svg.addEventListener('wheel', e => {
            e.preventDefault();
            const scaleFactor = e.deltaY < 0 ? 0.95 : 1.05;
            handleZoom(svg, scaleFactor, e.clientX, e.clientY);
        });

        zoomInBtn.addEventListener("click", () => handleZoom(svg, 0.95, svg.getBoundingClientRect().left + svg.getBoundingClientRect().width / 2, svg.getBoundingClientRect().top + svg.getBoundingClientRect().height / 2));
        zoomOutBtn.addEventListener("click", () => handleZoom(svg, 1.05, svg.getBoundingClientRect().left + svg.getBoundingClientRect().width / 2, svg.getBoundingClientRect().top + svg.getBoundingClientRect().height / 2));

        svg.addEventListener('mousedown', e => {
            isPanning = true;
            startPoint = { x: e.clientX, y: e.clientY };
        });

        svg.addEventListener('mousemove', e => {
            if (!isPanning) return;
            
            const dx = (e.clientX - startPoint.x) * (svg._viewBox.w / svg.clientWidth);
            const dy = (e.clientY - startPoint.y) * (svg._viewBox.h / svg.clientHeight);

            svg._viewBox.x -= dx;
            svg._viewBox.y -= dy;
            
            svg.setAttribute("viewBox", 
                `${svg._viewBox.x} ${svg._viewBox.y} ${svg._viewBox.w} ${svg._viewBox.h}`
            );
            
            startPoint = { x: e.clientX, y: e.clientY };
        });

        svg.addEventListener('mouseup', () => isPanning = false);
        svg.addEventListener('mouseleave', () => isPanning = false);
    }

    function updateSelects(searchQuery = '') {
        console.log('updateSelects called with query:', searchQuery);
        console.log('allNodes length:', allNodes.length);
        console.log('allNodes:', allNodes);

        endSel.innerHTML = '';
        const query = searchQuery.trim().toLowerCase();
        const filteredNodes = allNodes.filter(node => {
            if (!node.name || node.edges.length !== 1 || node.name === "0") {
                return false;
            }
            const name = node.name.toLowerCase();
            return query === '' || name.includes(query);
        });

        console.log('filteredNodes:', filteredNodes);

        if (filteredNodes.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = query === '' ? 'Выберите аудиторию' : 'Аудитория не найдена';
            option.disabled = true;
            option.selected = true;
            endSel.appendChild(option);
        } else {
            filteredNodes.forEach(node => {
                const option = document.createElement('option');
                option.value = `${node.floor}|${node.id}`;
                option.textContent = `${node.name} (${node.floor})`;
                endSel.appendChild(option);
            });
        }
    }

    async function loadFloors() {
        const svgFiles = [
            { path: 'floors/floor1.svg', name: 'Этаж 1' },
            { path: 'floors/floor2.svg', name: 'Этаж 2' }
        ];

        floorButtons.innerHTML = '';
        multiGraph.floors.clear();
        errorMsg.textContent = '';

        try {
            for (const [index, file] of svgFiles.entries()) {
                const response = await fetch(file.path);
                if (!response.ok) {
                    throw new Error(`Не удалось загрузить файл ${file.path}`);
                }
                const content = await response.text();
                if (!content.includes('<svg')) {
                    throw new Error(`Файл ${file.path} не является валидным SVG`);
                }
                const floorId = file.name;
                multiGraph.addFloor(floorId, content);
                
                const btn = document.createElement('button');
                btn.className = 'floor-btn';
                btn.textContent = floorId;
                btn.onclick = () => {
                    showFloor(floorId);
                };
                floorButtons.appendChild(btn);
            }
            const startNode = multiGraph.getStartNode();
            if (!startNode) {
                throw new Error("Узел с именем '0' не найден");
            }
            allNodes = multiGraph.getAllNodes();
            console.log('Nodes loaded:', allNodes);
            if (svgFiles.length > 0) {
                showFloor('Этаж 1');
                updateSelects();
            }
        } catch (e) {
            errorMsg.textContent = e.message;
            console.error(e);
        }
    }

    function updateNextFloorMessage(floorId, path) {
        nextFloorSpan.textContent = '';
        document.querySelectorAll('.floor-btn').forEach(btn => {
            btn.classList.remove('highlight');
            if (btn.textContent === floorId) {
                btn.classList.add('current-floor');
            }
        });

        for (let i = 0; i < path.length - 1; i++) {
            if (path[i].floor === floorId && path[i].floor !== path[i + 1].floor) {
                const nextFloor = path[i + 1].floor;
                nextFloorSpan.textContent = `Продолжите путь на ${nextFloor}`;
                const nextFloorBtn = Array.from(document.querySelectorAll('.floor-btn')).find(
                    btn => btn.textContent === nextFloor
                );
                if (nextFloorBtn) {
                    nextFloorBtn.classList.add('highlight');
                }
                break;
            }
        }
    }

    loadFloors();

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        console.log('Search input:', query);
        updateSelects(query);
    });

    findBtn.addEventListener("click", () => {
        errorMsg.textContent = '';
        pathRes.textContent = '';
        stairsUsed.textContent = '';
        nextFloorSpan.textContent = '';
        document.querySelectorAll('.floor-btn').forEach(btn => btn.classList.remove('highlight'));

        const startNode = multiGraph.getStartNode();
        if (!startNode) {
            errorMsg.textContent = "Узел с именем '0' не найден";
            return;
        }

        const endValue = endSel.value.split('|');
        if (endValue.length !== 2 || endSel.value === '') {
            errorMsg.textContent = 'Выберите аудиторию из списка';
            return;
        }

        const [startFloor, startId] = [startNode.floor, startNode.id];
        const [endFloor, endId] = endValue;

        try {
            const result = multiGraph.findPathMultiFloor(startFloor, startId, endFloor, endId);

            if (result) {
                lastPathResult = result;
                const pathDisplay = [];
                for (let i = 0; i < result.path.length; i++) {
                    const { floor, node } = result.path[i];
                    const floorData = multiGraph.floors.get(floor);
                    if (!floorData) {
                        throw new Error(`Этаж ${floor} не найден`);
                    }
                    const nodeData = floorData.graph.nodes.get(node);
                    if (!nodeData) {
                        throw new Error(`Узел ${node} не найден на этаже ${floor}`);
                    }
                    pathDisplay.push(nodeData.name || node);
                    if (i < result.path.length - 1 && result.path[i].floor !== result.path[i + 1].floor) {
                        pathDisplay.push(`→ переход →`);
                    }
                }

                pathRes.textContent = pathDisplay.join(' ');
                stairsUsed.textContent = [...new Set(result.stairs)].join(', ');

                showFloor(startFloor);
                const svg = svgContainer.querySelector("svg");
                visualizePath(svg, result.path, startFloor, 500);
                updateNextFloorMessage(startFloor, result.path);
            } else {
                errorMsg.textContent = "Путь не найден";
            }
        } catch (e) {
            errorMsg.textContent = e.message;
            console.error(e);
        }
    });

    resetBtn.addEventListener("click", () => {
        errorMsg.textContent = '';
        pathRes.textContent = '';
        stairsUsed.textContent = '';
        nextFloorSpan.textContent = '';
        selectedNodeSpan.textContent = '';
        searchInput.value = '';
        updateSelects();
        lastPathResult = null;
        document.querySelectorAll('.floor-btn').forEach(btn => {
            btn.classList.remove('highlight');
            if (btn.textContent === currentFloorId) {
                btn.classList.add('current-floor');
            }
        });
        if (currentFloorId) {
            showFloor(currentFloorId);
        }
    });

    window.addEventListener('resize', () => {
        if (currentFloorId) {
            showFloor(currentFloorId);
        }
    });
});