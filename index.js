/**
 * HELPERS
 */
// https://gist.github.com/xposedbones/75ebaef3c10060a3ee3b246166caab56
const constrain = (val, min, max) => (val < min ? min : (val > max ? max : val))
const map = (value, x1, y1, x2, y2) => (value - x1) * (y2 - x2) / (y1 - x1) + x2;

/**
 * GRAPHING
 */

class Color {
    constructor(r, g, b, a) {
        this.r = r;
        this.b = b;
        this.g = g;
        this.a = a;
    }
}

class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}

class Image {
    constructor(ctx, width, height) {
        this.ctx = ctx;
        this.width = width;
        this.height = height;
    };
    // Convert from SVG coords into pixels
    get_image_point(svg_point, bounding_box) {
        let x = Math.floor(map(svg_point.x, bounding_box.x, bounding_box.x + bounding_box.width, 0, this.width - 1));
        let y = Math.floor(map(svg_point.y, bounding_box.y, bounding_box.y + bounding_box.height, 0, this.height - 1));
        return new Point(x, y);
    };
}

// Create the graph
let graph = {
    init() {
        this.render_timeout_id = null;
        this.render_iter = 0;
        this.width = 30;
        this.height = this.width;
        this.radius = this.width / 3;
        this.max_iter = parseInt(GUI.num_connections.element.value);
        this.num_nails = parseInt(GUI.num_nails.element.value);

        this.downscale_factor = 4;

        this.thread_diam = 0.004; // thread width in inches (60WT)
        this.nail_diam = 0.1;
        this.nails_pos = [];

        this.thread_opacity = 1.0;
        this.thread_order = [];

        // Worker pool
        this.workers = [];
        this.abortController = null;

        this.svg = d3.select("body").insert("svg", ":first-child")
            .attr("width", "100vw")
            .attr("viewBox", [-this.width / 2, -this.height / 2, this.width, this.height])
        this.svg.append("g");
        this.svg.attr("desc", "Created using michael-crum.com/string-art-gen");

        let frame_path = this.svg.select("g")
            .append("circle")
            .attr("r", this.radius)
            .style("stroke", "#ffbe5700")
            .style("stroke-width", 10)
            .style("fill", "none");

        this.frame_bb = frame_path.node().getBBox();

        let nails_lst = [];
        for (let i = 0; i < this.num_nails; i++) {
            nails_lst.push(i);
        }
        let frame_length = frame_path.node().getTotalLength();

        // Append nails evenly around the frame, and store their locations in a list
        let nails = this.svg.select("g")
            .selectAll("circle.nail")
            .data(nails_lst)
            .join("g")
            .attr("transform", (d) => {
                let pos = frame_path.node().getPointAtLength((d / this.num_nails) * frame_length);
                this.nails_pos.push(new Point(pos.x, pos.y));
                return `translate(${pos.x}, ${pos.y})`;
            });
        nails.append("circle")
            .attr("class", "nail")
            .attr("r", this.nail_diam / 2)
            .attr("fill", "aqua");

        nails.append("text")
            .style("fill", "black")
            .style("stroke-width", `${this.nail_diam / 100}`)
            .style("stroke", "white")
            .attr("dx", "0")
            .attr("dy", `${(this.nail_diam / 2) * 0.7}`)
            .attr("font-size", `${this.nail_diam}px`)
            .attr("text-anchor", "middle")
            .text(function (d, i) { return i });

        this.get_frame_url();
        frame_path.style("fill", "grey");

        // Handle zooming and panning
        let zoom = d3.zoom().on('zoom', handleZoom);

        function handleZoom(e) {
            d3.selectAll('svg > g')
                .attr('transform', e.transform);
        }

        d3.select('svg').call(zoom);
    },
    get_frame_url() {
        var serializer = new XMLSerializer();
        var source = serializer.serializeToString(this.svg.node());

        //add name spaces.
        if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
            source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        if (!source.match(/^<svg[^>]+"http\:\/\/www\.w3\.org\/1999\/xlink"/)) {
            source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
        }

        //add xml declaration
        source = '<?xml version="1.0" standalone="no"?>\r\n' + source;

        //convert svg source to URI data scheme.
        this.frame_url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
    },
    download_frame() {
        var element = document.createElement('a');
        element.setAttribute("href", `${this.frame_url}`);
        element.setAttribute('download', "frame.svg");
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    },
    download_nail_seq() {
        let output = `Generated using https://michael-crum.com/string-art-gen/\n${this.render_iter} connections in total\n\n`;
        let len = this.thread_order.length;
        for (var i = 0; i < len; i++) {
            let thread = this.threads[this.thread_order[i]];
            if (i === 0 || this.thread_order[i - 1] !== this.thread_order[i])
                output += `\nThread: [${thread.color.r}, ${thread.color.g}, ${thread.color.b}]\n`;

            output += thread.nail_order[thread.read_head];
            thread.read_head++;
            output += "\n";
        }
        for (var i = 0; i < this.threads.length; i++) {
            this.threads[i].read_head = 0;
        }
        var url = "data:text/plain;charset=utf-8," + encodeURIComponent(output);
        var element = document.createElement('a');
        element.setAttribute("href", `${url}`);
        element.setAttribute('download', "nail_seq.txt");
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    },

    setup(img) {
        this.render_iter = 0;
        this.image = img;
        this.orig_ctx = img.ctx;

        // Get original image pixel data
        this.orig_ctx_data = this.orig_ctx.getImageData(0, 0, this.image.width, this.image.height).data;

        // Create a writable current buffer initialized to grey
        let current_canvas = document.createElement("canvas");
        current_canvas.width = img.width;
        current_canvas.height = img.height;
        let current_ctx = current_canvas.getContext('2d');
        current_ctx.fillStyle = "grey";
        current_ctx.fillRect(0, 0, this.image.width, this.image.height);
        const initialData = current_ctx.getImageData(0, 0, this.image.width, this.image.height).data;
        this.current_ctx_data = new Uint8ClampedArray(initialData);

        this.fade = 1 / (this.downscale_factor * 1.8);

        // Pre-compute adjusted nail positions as a flat Float64Array
        this.nailsAdj = new Float64Array(this.num_nails * 2);
        for (let i = 0; i < this.num_nails; i++) {
            const adjPt = this.image.get_image_point(this.nails_pos[i], this.frame_bb);
            this.nailsAdj[i * 2] = adjPt.x;
            this.nailsAdj[i * 2 + 1] = adjPt.y;
        }

        this.threads = [
            { current_nail: 0, color: new Color(0, 0, 0, 255), nail_order: [0], prev_connections: {}, read_head: 0 },       // black
            { current_nail: 0, color: new Color(255, 255, 255, 255), nail_order: [0], prev_connections: {}, read_head: 0 }   // white
        ];
        this.svg.select("g")
            .selectAll(".string")
            .remove();
        this.thread_order = [];
    },

    terminateWorkers() {
        this.workers.forEach(w => w.terminate());
        this.workers = [];
    },

    async parse_image() {
        // Cancel any previous run
        if (this.abortController) {
            this.abortController.abort();
        }
        this.terminateWorkers();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const NUM_WORKERS = Math.min(navigator.hardwareConcurrency || 4, 8);

        // Create workers
        for (let i = 0; i < NUM_WORKERS; i++) {
            this.workers.push(new Worker('./worker.js'));
        }

        // Initialize all workers with data
        await Promise.all(this.workers.map(w => new Promise(resolve => {
            const handler = (e) => {
                if (e.data.type === 'init-done') {
                    w.removeEventListener('message', handler);
                    resolve();
                }
            };
            w.addEventListener('message', handler);
            w.postMessage({
                type: 'init',
                origData: this.orig_ctx_data.buffer.slice(0),
                currentData: this.current_ctx_data.buffer.slice(0),
                imageWidth: this.image.width,
                imageHeight: this.image.height,
                fade: this.fade,
                nailsAdj: this.nailsAdj.buffer.slice(0),
                numNails: this.num_nails
            });
        })));

        if (signal.aborted) { this.terminateWorkers(); return; }

        const SVG_BATCH_SIZE = 50;
        const svgBatch = [];
        const g = this.svg.select("g");

        for (let iter = 0; iter < this.max_iter; iter++) {
            if (signal.aborted) { this.terminateWorkers(); return; }

            // Evaluate all threads across all workers in parallel
            const nailsPerWorker = Math.ceil(this.num_nails / NUM_WORKERS);
            const evalPromises = [];

            for (let tIdx = 0; tIdx < this.threads.length; tIdx++) {
                const thread = this.threads[tIdx];
                for (let wIdx = 0; wIdx < NUM_WORKERS; wIdx++) {
                    const nailStart = wIdx * nailsPerWorker;
                    const nailEnd = Math.min(nailStart + nailsPerWorker, this.num_nails);
                    evalPromises.push(new Promise(resolve => {
                        const handler = (e) => {
                            if (e.data.type === 'evaluate-result' &&
                                e.data.requestId === tIdx) {
                                this.workers[wIdx].removeEventListener('message', handler);
                                resolve(e.data);
                            }
                        };
                        this.workers[wIdx].addEventListener('message', handler);
                        this.workers[wIdx].postMessage({
                            type: 'evaluate',
                            threadIndex: tIdx,
                            currentNail: thread.current_nail,
                            colorR: thread.color.r,
                            colorG: thread.color.g,
                            colorB: thread.color.b,
                            colorA: thread.color.a,
                            nailStart,
                            nailEnd,
                            requestId: tIdx
                        });
                    }));
                }
            }

            const results = await Promise.all(evalPromises);

            if (signal.aborted) { this.terminateWorkers(); return; }

            // Find global best across all threads and all worker chunks
            let winnerThreadIdx = -1;
            let winnerNail = -1;
            let winnerDist = Infinity;

            for (const r of results) {
                if (r.bestDist < winnerDist) {
                    winnerDist = r.bestDist;
                    winnerThreadIdx = r.threadIndex;
                    winnerNail = r.bestNail;
                }
            }

            if (winnerDist === Infinity) break; // No improvement possible

            const winThread = this.threads[winnerThreadIdx];
            const prevNail = winThread.current_nail;

            // Record connection in main thread state
            const connKey = prevNail;
            if (!winThread.prev_connections[connKey])
                winThread.prev_connections[connKey] = {};
            winThread.prev_connections[connKey][winnerNail] = true;

            // Update main thread pixel buffer (pure math, no canvas)
            const pixels = bresenham(
                this.nailsAdj[prevNail * 2], this.nailsAdj[prevNail * 2 + 1],
                this.nailsAdj[winnerNail * 2], this.nailsAdj[winnerNail * 2 + 1]
            );
            applyLineToBuffer(
                pixels, this.fade,
                winThread.color.r, winThread.color.g, winThread.color.b, winThread.color.a,
                this.current_ctx_data, this.image.width
            );

            // Tell all workers to apply the same buffer update and record the connection
            const drawPromises = this.workers.map(w => new Promise(resolve => {
                const handler = (e) => {
                    if (e.data.type === 'draw-done') {
                        w.removeEventListener('message', handler);
                        resolve();
                    }
                };
                w.addEventListener('message', handler);
                w.postMessage({
                    type: 'draw',
                    nailA: prevNail,
                    nailB: winnerNail,
                    colorR: winThread.color.r,
                    colorG: winThread.color.g,
                    colorB: winThread.color.b,
                    colorA: winThread.color.a
                });
            }));

            // Send prev_connection update (fire-and-forget, no ack needed)
            this.workers.forEach(w => {
                w.postMessage({
                    type: 'add-prev-connection',
                    threadIndex: winnerThreadIdx,
                    srcNail: prevNail,
                    dstNail: winnerNail
                });
            });

            await Promise.all(drawPromises);

            // Update thread state
            winThread.current_nail = winnerNail;
            winThread.nail_order.push(winnerNail);
            this.thread_order.push(winnerThreadIdx);
            this.render_iter = iter + 1;

            // Batch SVG rendering
            const startPos = this.nails_pos[prevNail];
            const endPos = this.nails_pos[winnerNail];
            svgBatch.push({
                points: [[startPos.x, startPos.y], [endPos.x, endPos.y]],
                color: winThread.color
            });

            if (svgBatch.length >= SVG_BATCH_SIZE || iter === this.max_iter - 1) {
                for (const item of svgBatch) {
                    g.append('path')
                        .attr("d", `M ${item.points[0][0]},${item.points[0][1]} L ${item.points[1][0]},${item.points[1][1]}`)
                        .attr("class", "string")
                        .style("stroke-width", this.thread_diam)
                        .style("stroke", `rgba(${item.color.r},${item.color.g},${item.color.b},${this.thread_opacity})`)
                        .style("fill", "none");
                }
                svgBatch.length = 0;

                GUI.regenerate.element.innerHTML =
                    `<b>Generating... ${((iter / this.max_iter) * 100).toFixed(2)}%</b>`;

                // Yield to browser for UI rendering
                await new Promise(r => setTimeout(r, 0));
            }
        }

        // Flush any remaining SVG
        for (const item of svgBatch) {
            g.append('path')
                .attr("d", `M ${item.points[0][0]},${item.points[0][1]} L ${item.points[1][0]},${item.points[1][1]}`)
                .attr("class", "string")
                .style("stroke-width", this.thread_diam)
                .style("stroke", `rgba(${item.color.r},${item.color.g},${item.color.b},${this.thread_opacity})`)
                .style("fill", "none");
        }

        this.clean();
    },

    clean() {
        GUI.regenerate.element.innerHTML = "<b>Regenerate</b>";
        this.terminateWorkers();
        this.svg.selectAll("g circle.nail").raise();
    }
};

/**
 * UI
 */
class UIElement {
    constructor(desc, name, parent, callback, label) {
        this.desc = desc;
        this.name = name;
        this.parent = parent;
        this.callback = callback;
        if (label) {
            this.label = document.createElement("label");
            this.label.for = name;
            this.label.innerHTML = desc;
            parent.appendChild(this.label);
        }
    }
}

class Slider extends UIElement {
    constructor(desc, name, parent, init_val, min, max, callback) {
        super(desc, name, parent, callback, true);
        this.val = init_val;
        this.min = min;
        this.max = max;
        this.disp = document.createElement("input");
        this.disp.type = "number";
        this.disp.min = min;
        this.disp.max = max;
        this.disp.value = this.val;
        this.disp.classList.add("slider-number");
        parent.appendChild(this.disp);
        this.element = document.createElement("input");
        this.element.id = name;
        this.element.type = "range";
        this.element.classList.add("slider");
        this.element.min = min;
        this.element.max = max;
        this.element.value = this.val;
        this.element.addEventListener("input", (e) => { this.disp.value = e.target.value; callback(e); });
        this.disp.addEventListener("change", (e) => {
            let v = constrain(parseInt(e.target.value), min, max);
            e.target.value = v;
            this.element.value = v;
            callback({ target: this.element });
        });
        parent.appendChild(this.element);
    }
}

class Button extends UIElement {
    constructor(desc, name, parent, callback) {
        super(desc, name, parent, callback, false);
        this.element = document.createElement("button");
        this.element.id = name;
        this.element.innerHTML = `<b> ${this.desc}</b>`;
        this.element.addEventListener("click", callback);
        parent.appendChild(this.element);
    }
}

class TextEntry extends UIElement {
    constructor(desc, name, parent, value, callback) {
        super(desc, name, parent, callback, true);
        this.element = document.createElement("input");
        this.element.type = "text";
        this.element.value = value;
        parent.appendChild(this.element);
    }
}

let download = document.getElementById("download");
let basic_options = document.getElementById("basic");
let advanced_options = document.getElementById("advanced");
let controls = document.getElementById("controls");

let GUI = {
    init() {
        // Download =
        this.nail_seq_download = new Button(
            "Nail sequence",
            "nail_sequence",
            download,
            () => {
                graph.download_nail_seq();
            });
        this.frame_download = new Button(
            "Frame with numbering",
            "frame_download",
            download,
            () => {
                graph.download_frame();
            });
        // Basic
        this.regenerate = new Button(
            "Regenerate",
            "regenerate",
            controls,
            () => {
                render_image()
            });
        this.num_nails = new Slider(
            "Number of nails:",
            "num_nails",
            basic_options,
            300,
            10, 2000,
            (e) => {
                graph.num_nails = parseInt(e.target.value);
                render_image();
            });
        this.num_connections = new Slider(
            "Max # of connections:",
            "num_connections",
            basic_options,
            10000,
            100, 30000,
            (e) => {
                graph.max_iter = parseInt(e.target.value);
                render_image();
            });

        // Advanced
        this.shape_entry = new TextEntry(
            "Frame path (SVG):",
            "num_connections",
            advanced_options,
            "WIP, come back soon :)",
            (e) => {

            });
    }
}

GUI.init();

/**
* IMAGE PROCESSING
 */

function render_image(url) {
    if (graph.svg) {
        graph.svg.selectAll("*").remove();
        graph.svg.remove();
        if (graph.abortController) graph.abortController.abort();
        graph.terminateWorkers();
    }
    graph.init();
    var img = document.getElementById('snapshot');
    img.onload = function () {
        if (url) URL.revokeObjectURL(this.src);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Bunch of sloppy logic to resize the image / canvas to play nice with the frame bounding box.
        // The image is centered and scaled to fill the frame
        const max_res = ((graph.frame_bb.width / graph.thread_diam) / 2) / graph.downscale_factor;
        let frame_ar = graph.frame_bb.width / graph.frame_bb.height;
        let img_ar = img.width / img.height;
        canvas.width = frame_ar >= 1 ? max_res : max_res * frame_ar;
        canvas.height = frame_ar < 1 ? max_res : max_res / frame_ar;
        let w = frame_ar >= img_ar ? canvas.width : canvas.height * img_ar;
        let h = frame_ar < img_ar ? canvas.height : canvas.width / img_ar;
        ctx.drawImage(img, - (w - canvas.width) / 2, - (h - canvas.height) / 2, w, h);
        let new_img = new Image(ctx, canvas.width, canvas.height);
        graph.setup(new_img);
        graph.parse_image();
    }
    if (url) {
        img.src = url;
    } else if (img.complete) {
        img.onload();
    } else {
        img.src = img.src;
    }
}

render_image();

const input = document.querySelector("input[type='file']");
input.addEventListener("change", function () {
    if (this.files && this.files[0]) {
        render_image(URL.createObjectURL(this.files[0]));
    }
})

/**
 * MISC
 */

// Hide UI if query param is present
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("showUI") === "false") {
    document.getElementById("ui").style.display = "none";
    graph.svg.style("width", "100vw")
        .style("left", "0px");
}
