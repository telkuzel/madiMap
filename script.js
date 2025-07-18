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

        // Process <line> elements
        const lines = Array.from(svg.querySelectorAll("line"));
        lines.forEach(line => {
            const x1 = parseFloat(line.getAttribute("x1")) || 0;
            const y1 = parseFloat(line.getAttribute("y1")) || 0;
            const x2 = parseFloat(line.getAttribute("x2")) || 0;
            const y2 = parseFloat(line.getAttribute("y2")) || 0;
            const stroke = line.getAttribute("stroke")?.toLowerCase();

            if (stroke === "red" || stroke === "#ff0000") {
                walls.push({ type: 'line', x1, y1, x2, y2 });
            } else {
                this.registerPoint(points, graph, x1, y1);
                this.registerPoint(points, graph, x2, y2);

                const a = this.findPointId(points, x1, y1);
                const b = this.findPointId(points, x2, y2);
                if (a && b) graph.addEdge(a, b);
            }
        });

        // Process <path> elements
        const paths = Array.from(svg.querySelectorAll("path"));
        paths.forEach(path => {
            const stroke = path.getAttribute("stroke")?.toLowerCase();
            if (stroke === "red" || stroke === "#ff0000") {
                const d = path.getAttribute("d") || "";
                if (d.trim()) {
                    walls.push({ type: 'wall-path', d });
                }
            }
        });

        const texts = Array.from(svg.querySelectorAll("text"));
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
    const zoomInBtn = document.getElementById("zoomInBtn");
    const zoomOutBtn = document.getElementById("zoomOutBtn");

    let allNodes = [];
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

        // Render walls
        walls.forEach(wall => {
            if (wall.type === 'line') {
                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line.setAttribute("x1", wall.x1);
                line.setAttribute("y1", wall.y1);
                line.setAttribute("x2", wall.x2);
                line.setAttribute("y2", wall.y2);
                line.setAttribute("class", "wall wall-vis");
                line.removeAttribute("stroke"); // Remove inline stroke to rely on CSS
                line.removeAttribute("stroke-width"); // Remove inline stroke-width
                svg.appendChild(line);
            } else if (wall.type === 'wall-path') {
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", wall.d);
                path.setAttribute("class", "wall wall-vis");
                path.removeAttribute("stroke"); // Remove inline stroke to rely on CSS
                path.removeAttribute("stroke-width"); // Remove inline stroke-width
                svg.appendChild(path);
            }
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
            svg.appendChild(circle);
        });
    }

    function centerSVG(svg) {
        let viewBoxAttr = svg.getAttribute('viewBox');
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        const lines = svg.querySelectorAll('line');
        const paths = svg.querySelectorAll('path');
        const circles = svg.querySelectorAll('circle');

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

        paths.forEach(path => {
            const d = path.getAttribute('d') || "";
            const commands = d.split(/(?=[ML])/);
            commands.forEach(command => {
                const coords = command.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
                if (coords.length >= 2) {
                    minX = Math.min(minX, coords[0]);
                    minY = Math.min(minY, coords[1]);
                    maxX = Math.max(maxX, coords[0]);
                    maxY = Math.max(maxY, coords[1]);
                }
            });
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

        if (!viewBoxAttr) {
            viewBoxAttr = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
            svg.setAttribute('viewBox', viewBoxAttr);
        }

        const [x, y, width, height] = viewBoxAttr.split(' ').map(parseFloat);
        const padding = 20;

        const newViewBox = `${x - padding} ${y - padding} ${width + 2 * padding} ${height + 2 * padding}`;
        svg.setAttribute('viewBox', newViewBox);

        const margin = Math.max(width, height) * 0.2;
        svg._bounds = {
            minX: minX - margin,
            maxX: maxX + margin,
            minY: minY - margin,
            maxY: maxY + margin
        };
        console.log('centerSVG: bounds initialized:', svg._bounds);

        svg._viewBox = {
            x: x - padding,
            y: y - padding,
            w: width + 2 * padding,
            h: height + 2 * padding,
            originalWidth: width,
            originalHeight: height
        };
        console.log('centerSVG: viewBox initialized:', svg._viewBox);
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
        if (!svg) {
            console.error('enablePanAndZoom: SVG element is not provided');
            return;
        }

        const viewBox = svg.getAttribute("viewBox")?.split(" ").map(parseFloat);
        if (!viewBox || viewBox.length !== 4) {
            console.error('enablePanAndZoom: Invalid viewBox', svg.getAttribute("viewBox"));
            return;
        }

        svg._viewBox = {
            x: viewBox[0],
            y: viewBox[1],
            w: viewBox[2],
            h: viewBox[3],
            originalWidth: viewBox[2],
            originalHeight: viewBox[3]
        };
        console.log('enablePanAndZoom: viewBox initialized:', svg._viewBox);

        const MIN_ZOOM = 0.3;
        const MAX_ZOOM = 8.0;

        let isPanning = false;
        let startPoint = { x: 0, y: 0 };
        let isPinching = false;
        let initialDistance = 0;

        function handleZoom(svg, scaleFactor, clientX, clientY) {
            if (!svg || !svg._viewBox) {
                console.error('handleZoom: svg or svg._viewBox is not initialized');
                return;
            }

            const rect = svg.getBoundingClientRect();
            const mouseX = clientX - rect.left;
            const mouseY = clientY - rect.top;

            const { x: vx, y: vy, w: vw, h: vh, originalWidth } = svg._viewBox;

            const newWidth = vw * scaleFactor;
            if (newWidth < originalWidth * MIN_ZOOM || newWidth > originalWidth * MAX_ZOOM) {
                console.log(`Zoom rejected: newWidth=${newWidth}, min=${originalWidth * MIN_ZOOM}, max=${originalWidth * MAX_ZOOM}`);
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

            if (svg._bounds) {
                const { minX, maxX, minY, maxY } = svg._bounds;
                svg._viewBox.x = Math.max(minX, Math.min(maxX - svg._viewBox.w, svg._viewBox.x));
                svg._viewBox.y = Math.max(minY, Math.min(maxY - svg._viewBox.h, svg._viewBox.y));
                console.log(`Zoom bounds applied: x=${svg._viewBox.x}, y=${svg._viewBox.y}, w=${svg._viewBox.w}, h=${svg._viewBox.h}`);
            }

            svg.setAttribute("viewBox", `${svg._viewBox.x} ${svg._viewBox.y} ${svg._viewBox.w} ${svg._viewBox.h}`);
            console.log(`Zoom applied: scaleFactor=${scaleFactor}, viewBox=${svg.getAttribute("viewBox")}`);
        }

        svg.addEventListener('wheel', e => {
            e.preventDefault();
            const scaleFactor = e.deltaY < 0 ? 0.95 : 1.05;
            console.log('Mouse wheel:', { deltaY: e.deltaY, scaleFactor });
            handleZoom(svg, scaleFactor, e.clientX, e.clientY);
        }, { passive: false });

        zoomInBtn.addEventListener("click", () => {
            console.log('Zoom in button clicked');
            handleZoom(svg, 0.95, svg.getBoundingClientRect().left + svg.getBoundingClientRect().width / 2, svg.getBoundingClientRect().top + svg.getBoundingClientRect().height / 2);
        });

        zoomOutBtn.addEventListener("click", () => {
            console.log('Zoom out button clicked');
            handleZoom(svg, 1.05, svg.getBoundingClientRect().left + svg.getBoundingClientRect().width / 2, svg.getBoundingClientRect().top + svg.getBoundingClientRect().height / 2);
        });

        svg.addEventListener('mousedown', e => {
            e.preventDefault();
            isPanning = true;
            startPoint = { x: e.clientX, y: e.clientY };
            console.log('Mouse down:', startPoint);
        }, { passive: false });

        svg.addEventListener('mousemove', e => {
            if (!isPanning) return;
            e.preventDefault();
            const dx = (e.clientX - startPoint.x) * (svg._viewBox.w / svg.clientWidth);
            const dy = (e.clientY - startPoint.y) * (svg._viewBox.h / svg.clientHeight);
            console.log('Mouse move:', { dx, dy, clientX: e.clientX, clientY: e.clientY });

            let newX = svg._viewBox.x - dx;
            let newY = svg._viewBox.y - dy;

            if (svg._bounds) {
                const { minX, maxX, minY, maxY } = svg._bounds;
                newX = Math.max(minX, Math.min(maxX - svg._viewBox.w, newX));
                newY = Math.max(minY, Math.min(maxY - svg._viewBox.h, newY));
                console.log('Mouse move bounds:', { newX, newY, bounds: svg._bounds });
            }

            svg._viewBox.x = newX;
            svg._viewBox.y = newY;
            
            svg.setAttribute("viewBox", `${svg._viewBox.x} ${svg._viewBox.y} ${svg._viewBox.w} ${svg._viewBox.h}`);
            startPoint = { x: e.clientX, y: e.clientY };
        }, { passive: false });

        svg.addEventListener('mouseup', () => {
            isPanning = false;
            console.log('Mouse up');
        });

        svg.addEventListener('mouseleave', () => {
            isPanning = false;
            console.log('Mouse leave');
        });

        function getTouchDistance(touches) {
            if (touches.length < 2) return 0;
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.hypot(dx, dy);
        }

        function getTouchCenter(touches) {
            if (touches.length === 1) {
                return { x: touches[0].clientX, y: touches[0].clientY };
            }
            return {
                x: (touches[0].clientX + touches[1].clientX) / 2,
                y: (touches[0].clientY + touches[1].clientY) / 2
            };
        }

        svg.addEventListener('touchstart', e => {
            e.preventDefault();
            console.log('Touch start:', { touches: e.touches.length });
            if (e.touches.length === 1) {
                isPanning = true;
                isPinching = false;
                startPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                console.log('Panning started:', startPoint);
            } else if (e.touches.length === 2) {
                isPanning = false;
                isPinching = true;
                initialDistance = getTouchDistance(e.touches);
                console.log('Pinching started:', { initialDistance });
            }
        }, { passive: false });

        svg.addEventListener('touchmove', e => {
            e.preventDefault();
            if (isPanning && e.touches.length === 1) {
                const touch = e.touches[0];
                const dx = (touch.clientX - startPoint.x) * (svg._viewBox.w / svg.clientWidth);
                const dy = (touch.clientY - startPoint.y) * (svg._viewBox.h / svg.clientHeight);
                console.log('Touch move (pan):', { dx, dy, clientX: touch.clientX, clientY: touch.clientY });

                let newX = svg._viewBox.x - dx;
                let newY = svg._viewBox.y - dy;

                if (svg._bounds) {
                    const { minX, maxX, minY, maxY } = svg._bounds;
                    newX = Math.max(minX, Math.min(maxX - svg._viewBox.w, newX));
                    newY = Math.max(minY, Math.min(maxY - svg._viewBox.h, newY));
                    console.log('Touch move bounds:', { newX, newY, bounds: svg._bounds });
                }

                svg._viewBox.x = newX;
                svg._viewBox.y = newY;
                svg.setAttribute("viewBox", `${svg._viewBox.x} ${svg._viewBox.y} ${svg._viewBox.w} ${svg._viewBox.h}`);
                startPoint = { x: touch.clientX, y: touch.clientY };
            } else if (isPinching && e.touches.length === 2) {
                const currentDistance = getTouchDistance(e.touches);
                if (initialDistance === 0) {
                    console.error('Touch move (pinch): initialDistance is 0');
                    return;
                }
                const scaleFactor = initialDistance / currentDistance;
                const center = getTouchCenter(e.touches);
                console.log('Touch move (pinch):', { scaleFactor, center, currentDistance });
                handleZoom(svg, scaleFactor, center.x, center.y);
                initialDistance = currentDistance;
            }
        }, { passive: false });

        svg.addEventListener('touchend', e => {
            e.preventDefault();
            isPanning = false;
            isPinching = false;
            initialDistance = 0;
            console.log('Touch end');
        }, { passive: false });

        svg.addEventListener('touchcancel', e => {
            e.preventDefault();
            isPanning = false;
            isPinching = false;
            initialDistance = 0;
            console.log('Touch cancel');
        }, { passive: false });
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
            console.error(e);
        }
    }

    function updateNextFloorMessage(floorId, path) {
        document.querySelectorAll('.floor-btn').forEach(btn => {
            btn.classList.remove('highlight');
            if (btn.textContent === floorId) {
                btn.classList.add('current-floor');
            }
        });

        for (let i = 0; i < path.length - 1; i++) {
            if (path[i].floor === floorId && path[i].floor !== path[i + 1].floor) {
                const nextFloor = path[i + 1].floor;
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
        document.querySelectorAll('.floor-btn').forEach(btn => btn.classList.remove('highlight'));

        const startNode = multiGraph.getStartNode();
        if (!startNode) {
            console.error("Узел с именем '0' не найден");
            return;
        }

        const endValue = endSel.value.split('|');
        if (endValue.length !== 2 || endSel.value === '') {
            console.error('Выберите аудиторию из списка');
            return;
        }

        const [startFloor, startId] = [startNode.floor, startNode.id];
        const [endFloor, endId] = endValue;

        try {
            const result = multiGraph.findPathMultiFloor(startFloor, startId, endFloor, endId);

            if (result) {
                lastPathResult = result;
                showFloor(startFloor);
                const svg = svgContainer.querySelector("svg");
                visualizePath(svg, result.path, startFloor, 500);
                updateNextFloorMessage(startFloor, result.path);
            } else {
                console.error("Путь не найден");
            }
        } catch (e) {
            console.error(e);
        }
    });

    resetBtn.addEventListener("click", () => {
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