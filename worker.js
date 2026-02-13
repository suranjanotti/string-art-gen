importScripts('./shared.js');

let state = {
    origData: null,
    currentData: null,
    imageWidth: 0,
    imageHeight: 0,
    fade: 0,
    nailsAdj: null,       // Float64Array: [x0,y0, x1,y1, ...] adjusted pixel coords
    numNails: 0,
    lineCache: {},
    prevConnections: {},   // key: "threadIdx_srcNail" -> Set of dst nails
};

self.onmessage = function (e) {
    const msg = e.data;
    switch (msg.type) {
        case 'init':
            handleInit(msg);
            break;
        case 'evaluate':
            handleEvaluate(msg);
            break;
        case 'draw':
            handleDraw(msg);
            break;
        case 'add-prev-connection':
            handleAddPrevConnection(msg);
            break;
    }
};

function handleInit(msg) {
    state.origData = new Uint8ClampedArray(msg.origData);
    state.currentData = new Uint8ClampedArray(msg.currentData);
    state.imageWidth = msg.imageWidth;
    state.imageHeight = msg.imageHeight;
    state.fade = msg.fade;
    state.nailsAdj = new Float64Array(msg.nailsAdj);
    state.numNails = msg.numNails;
    state.lineCache = {};
    state.prevConnections = {};
    self.postMessage({ type: 'init-done' });
}

function getOrCreateLine(nailA, nailB) {
    const minN = Math.min(nailA, nailB);
    const maxN = Math.max(nailA, nailB);
    const key = minN * 100000 + maxN;
    if (state.lineCache[key]) return state.lineCache[key];

    const ax = state.nailsAdj[nailA * 2];
    const ay = state.nailsAdj[nailA * 2 + 1];
    const bx = state.nailsAdj[nailB * 2];
    const by = state.nailsAdj[nailB * 2 + 1];
    const pixels = bresenham(ax, ay, bx, by);
    state.lineCache[key] = pixels;
    return pixels;
}

function handleEvaluate(msg) {
    const { threadIndex, currentNail, colorR, colorG, colorB, colorA,
        nailStart, nailEnd, requestId } = msg;

    let bestDist = Infinity;
    let bestNail = -1;

    const prevKey = threadIndex + '_' + currentNail;
    const prevSet = state.prevConnections[prevKey];

    for (let i = nailStart; i < nailEnd; i++) {
        if (i === currentNail) continue;

        const pixels = getOrCreateLine(currentNail, i);

        let dist = computeLineDiff(
            pixels, state.fade,
            colorR, colorG, colorB, colorA,
            state.origData, state.currentData, state.imageWidth
        );

        // Zero out previously used connections (penalize reuse)
        if (prevSet && prevSet.has(i)) {
            dist = 0;
        }

        if (dist < bestDist) {
            bestDist = dist;
            bestNail = i;
        }
    }

    // Only negative diffs represent improvement
    if (bestDist >= 0) {
        bestDist = Infinity;
    }

    self.postMessage({
        type: 'evaluate-result',
        requestId,
        threadIndex,
        bestNail,
        bestDist
    });
}

function handleDraw(msg) {
    const pixels = getOrCreateLine(msg.nailA, msg.nailB);
    applyLineToBuffer(
        pixels, state.fade,
        msg.colorR, msg.colorG, msg.colorB, msg.colorA,
        state.currentData, state.imageWidth
    );
    self.postMessage({ type: 'draw-done' });
}

function handleAddPrevConnection(msg) {
    const key = msg.threadIndex + '_' + msg.srcNail;
    if (!state.prevConnections[key]) {
        state.prevConnections[key] = new Set();
    }
    state.prevConnections[key].add(msg.dstNail);
}
