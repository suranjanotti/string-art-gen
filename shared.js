/**
 * Pure computation functions shared between main thread and Web Workers.
 * No DOM, no global state — only pure math.
 */

function bresenham(x0, y0, x1, y1) {
    const pixels = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1;
    const sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;

    while (true) {
        pixels.push(x0, y0); // flat pairs: [x0,y0, x1,y1, ...]
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
    return new Int32Array(pixels);
}

function computeLineDiff(pixels, fade, colorR, colorG, colorB, colorA,
                         origData, currentData, imageWidth) {
    const colorArr = [colorR, colorG, colorB, colorA];
    let totalDiff = 0;
    const pixelCount = pixels.length / 2;

    for (let i = 0; i < pixels.length; i += 2) {
        const px = pixels[i];
        const py = pixels[i + 1];
        const ind = (px + py * imageWidth) * 4;
        let pixelDiff = 0;
        for (let j = 0; j < 4; j++) {
            const newC = colorArr[j] * fade + currentData[ind + j] * (1 - fade);
            const diff = Math.abs(origData[ind + j] - newC) - Math.abs(currentData[ind + j] - origData[ind + j]);
            pixelDiff += diff;
        }
        if (pixelDiff < 0) {
            totalDiff += pixelDiff;
        }
        if (pixelDiff > 0) {
            totalDiff += pixelDiff / 5;
        }
    }
    return Math.pow(totalDiff / pixelCount, 3);
}

function applyLineToBuffer(pixels, fade, colorR, colorG, colorB, colorA,
                           bufferData, imageWidth) {
    for (let i = 0; i < pixels.length; i += 2) {
        const px = pixels[i];
        const py = pixels[i + 1];
        const ind = (px + py * imageWidth) * 4;
        bufferData[ind]     = colorR * fade + bufferData[ind]     * (1 - fade);
        bufferData[ind + 1] = colorG * fade + bufferData[ind + 1] * (1 - fade);
        bufferData[ind + 2] = colorB * fade + bufferData[ind + 2] * (1 - fade);
        bufferData[ind + 3] = colorA * fade + bufferData[ind + 3] * (1 - fade);
    }
}
