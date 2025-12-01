import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Image as ImageIcon, Settings, Lock, Unlock, ZoomIn, ZoomOut, Grid, Sun, Contrast, Maximize, ChevronDown, ChevronRight, RotateCcw, X, Layers, Box, Droplet, Zap, Scan } from 'lucide-react';

// --- Math & Homography Helpers ---

function solve(A, B) {
    const n = A.length;
    for (let i = 0; i < n; i++) {
        let maxEl = Math.abs(A[i][i]);
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(A[k][i]) > maxEl) {
                maxEl = Math.abs(A[k][i]);
                maxRow = k;
            }
        }

        for (let k = i; k < n; k++) {
            const tmp = A[maxRow][k];
            A[maxRow][k] = A[i][k];
            A[i][k] = tmp;
        }
        const tmp = B[maxRow];
        B[maxRow] = B[i];
        B[i] = tmp;

        for (let k = i + 1; k < n; k++) {
            const c = -A[k][i] / A[i][i];
            for (let j = i; j < n; j++) {
                if (i === j) {
                    A[k][j] = 0;
                } else {
                    A[k][j] += c * A[i][j];
                }
            }
            B[k] += c * B[i];
        }
    }

    const x = new Array(n).fill(0);
    for (let i = n - 1; i > -1; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) {
            sum += A[i][j] * x[j];
        }
        x[i] = (B[i] - sum) / A[i][i];
    }
    return x;
}

function getHomographyMatrix(src, dst) {
    const A = [];
    const B = [];

    for (let i = 0; i < 4; i++) {
        const s = src[i];
        const d = dst[i];
        A.push([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x]);
        A.push([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y]);
        B.push(d.x);
        B.push(d.y);
    }

    const h = solve(A, B);
    h.push(1);

    return [
        [h[0], h[1], h[2]],
        [h[3], h[4], h[5]],
        [h[6], h[7], h[8]]
    ];
}

function inverseMatrix(M) {
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
        M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
        M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);

    if (det === 0) return null;
    const invDet = 1 / det;

    return [
        [
            (M[1][1] * M[2][2] - M[1][2] * M[2][1]) * invDet,
            (M[0][2] * M[2][1] - M[0][1] * M[2][2]) * invDet,
            (M[0][1] * M[1][2] - M[0][2] * M[1][1]) * invDet
        ],
        [
            (M[1][2] * M[2][0] - M[1][0] * M[2][2]) * invDet,
            (M[0][0] * M[2][2] - M[0][2] * M[2][0]) * invDet,
            (M[0][2] * M[1][0] - M[0][0] * M[1][2]) * invDet
        ],
        [
            (M[1][0] * M[2][1] - M[1][1] * M[2][0]) * invDet,
            (M[0][1] * M[2][0] - M[0][0] * M[2][1]) * invDet,
            (M[0][0] * M[1][1] - M[0][1] * M[1][0]) * invDet
        ]
    ];
}

// --- PBR Helpers ---

const generateNormalMap = (ctx, width, height, strength) => {
    const srcData = ctx.getImageData(0, 0, width, height);
    const src = srcData.data;
    const dstData = ctx.createImageData(width, height);
    const dst = dstData.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;

            let dx = 0;
            let dy = 0;

            if (x > 0 && x < width - 1) {
                const left = (src[(y * width + (x - 1)) * 4] + src[(y * width + (x - 1)) * 4 + 1] + src[(y * width + (x - 1)) * 4 + 2]) / 3;
                const right = (src[(y * width + (x + 1)) * 4] + src[(y * width + (x + 1)) * 4 + 1] + src[(y * width + (x + 1)) * 4 + 2]) / 3;
                dx = (left - right) * strength;
            }

            if (y > 0 && y < height - 1) {
                const top = (src[((y - 1) * width + x) * 4] + src[((y - 1) * width + x) * 4 + 1] + src[((y - 1) * width + x) * 4 + 2]) / 3;
                const bottom = (src[((y + 1) * width + x) * 4] + src[((y + 1) * width + x) * 4 + 1] + src[((y + 1) * width + x) * 4 + 2]) / 3;
                dy = (top - bottom) * strength;
            }

            let nz = 1.0;
            const len = Math.sqrt(dx * dx + dy * dy + nz * nz);

            dst[idx] = ((dx / len) + 1) * 0.5 * 255;
            dst[idx + 1] = ((dy / len) + 1) * 0.5 * 255;
            dst[idx + 2] = ((nz / len) + 1) * 0.5 * 255;
            dst[idx + 3] = 255;
        }
    }
    return dstData;
};

const generateRoughnessMap = (ctx, width, height, contrast, brightness) => {
    const srcData = ctx.getImageData(0, 0, width, height);
    const src = srcData.data;
    const dstData = ctx.createImageData(width, height);
    const dst = dstData.data;

    const c = (contrast + 100) / 100;
    const b = (brightness - 100) * 2.55;

    for (let i = 0; i < src.length; i += 4) {
        let gray = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114);
        let val = 255 - gray; // Invert
        val = c * (val - 128) + 128 + b;
        val = Math.max(0, Math.min(255, val));

        dst[i] = val;
        dst[i + 1] = val;
        dst[i + 2] = val;
        dst[i + 3] = 255;
    }
    return dstData;
};

const generateMetallicMap = (ctx, width, height, threshold) => {
    const srcData = ctx.getImageData(0, 0, width, height);
    const src = srcData.data;
    const dstData = ctx.createImageData(width, height);
    const dst = dstData.data;

    for (let i = 0; i < src.length; i += 4) {
        let gray = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114);
        let val = gray > threshold ? 255 : 0;
        dst[i] = val;
        dst[i + 1] = val;
        dst[i + 2] = val;
        dst[i + 3] = 255;
    }
    return dstData;
};

// --- Components ---

const CollapsibleSection = ({ title, children, defaultOpen = false, icon: Icon }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="border border-brown-700 bg-brown-900">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-2 bg-brown-800 hover:bg-brown-700 transition-colors text-xs font-bold text-brown-200 uppercase tracking-wider"
            >
                <div className="flex items-center gap-2">
                    {Icon && <Icon size={14} className="text-accent-DEFAULT" />}
                    {title}
                </div>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {isOpen && (
                <div className="p-3 space-y-3 border-t border-brown-700">
                    {children}
                </div>
            )}
        </div>
    );
};

// --- Main Component ---

export default function App() {
    const [imageSrc, setImageSrc] = useState(null);
    const [points, setPoints] = useState([
        { x: 50, y: 50 },
        { x: 250, y: 50 },
        { x: 250, y: 250 },
        { x: 50, y: 250 }
    ]);
    const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
    const [outputSize, setOutputSize] = useState({ w: 1024, h: 1024 });
    const [isProcessing, setIsProcessing] = useState(false);
    const [activePointIndex, setActivePointIndex] = useState(null);
    const [lockAspectRatio, setLockAspectRatio] = useState(false);
    const [fileFormat, setFileFormat] = useState('image/png');
    const [quality, setQuality] = useState(0.92);

    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });
    const [showGrid, setShowGrid] = useState(true);
    const [brightness, setBrightness] = useState(100);
    const [contrast, setContrast] = useState(100);
    const [magnifierPos, setMagnifierPos] = useState(null);

    // PBR State
    const [activeMap, setActiveMap] = useState('base');
    const [normalStrength, setNormalStrength] = useState(2.0);
    const [roughnessContrast, setRoughnessContrast] = useState(100);
    const [roughnessBrightness, setRoughnessBrightness] = useState(100);
    const [metallicThreshold, setMetallicThreshold] = useState(128);

    const canvasRef = useRef(null);
    const resultCanvasRef = useRef(null);
    const containerRef = useRef(null);
    const fileInputRef = useRef(null);
    const imageRef = useRef(null);

    const handleImageLoad = (e) => {
        const { naturalWidth, naturalHeight } = e.target;
        setImgSize({ w: naturalWidth, h: naturalHeight });

        setZoom(1);
        setPan({ x: 0, y: 0 });

        const padX = naturalWidth * 0.15;
        const padY = naturalHeight * 0.15;
        setPoints([
            { x: padX, y: padY },
            { x: naturalWidth - padX, y: padY },
            { x: naturalWidth - padX, y: naturalHeight - padY },
            { x: padX, y: naturalHeight - padY }
        ]);

        const initialW = 1024;
        const initialH = Math.round(initialW * (naturalHeight / naturalWidth));
        setOutputSize({ w: initialW, h: initialH });
    };

    const handleFileUpload = (e) => {
        e.preventDefault();
        const file = e.target.files?.[0] || e.dataTransfer?.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => setImageSrc(evt.target.result);
            reader.readAsDataURL(file);
        }
    };

    const handleReset = () => {
        if (!imgSize.w) return;
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setBrightness(100);
        setContrast(100);
        const padX = imgSize.w * 0.15;
        const padY = imgSize.h * 0.15;
        setPoints([
            { x: padX, y: padY },
            { x: imgSize.w - padX, y: padY },
            { x: imgSize.w - padX, y: imgSize.h - padY },
            { x: padX, y: imgSize.h - padY }
        ]);
    };

    const handleAutoDetect = () => {
        if (!imageSrc || imgSize.w === 0) return;

        const tempCanvas = document.createElement('canvas');
        const scale = 512 / Math.max(imgSize.w, imgSize.h);
        const w = Math.floor(imgSize.w * scale);
        const h = Math.floor(imgSize.h * scale);
        tempCanvas.width = w;
        tempCanvas.height = h;
        const ctx = tempCanvas.getContext('2d');

        const img = new Image();
        img.src = imageSrc;
        img.onload = () => {
            ctx.drawImage(img, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;

            let minX = w, minY = h, maxX = 0, maxY = 0;
            const threshold = 30;

            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    const i = (y * w + x) * 4;
                    const intensity = (data[i] + data[i + 1] + data[i + 2]) / 3;
                    const right = (data[i + 4] + data[i + 5] + data[i + 6]) / 3;
                    const bottom = (data[i + w * 4] + data[i + w * 4 + 1] + data[i + w * 4 + 2]) / 3;

                    if (Math.abs(intensity - right) > threshold || Math.abs(intensity - bottom) > threshold) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            if (maxX <= minX || maxY <= minY || (maxX - minX) < w * 0.2) {
                handleReset();
                return;
            }

            const p1 = { x: minX / scale, y: minY / scale };
            const p2 = { x: maxX / scale, y: minY / scale };
            const p3 = { x: maxX / scale, y: maxY / scale };
            const p4 = { x: minX / scale, y: maxY / scale };

            setPoints([p1, p2, p3, p4]);
        };
    };

    // --- Zoom & Pan Logic ---

    const handleWheel = (e) => {
        if (!imageSrc) return;
        e.preventDefault();
        const scaleAmount = -e.deltaY * 0.001;
        const newZoom = Math.min(Math.max(0.1, zoom + scaleAmount), 5);
        setZoom(newZoom);
    };

    const handleContainerMouseDown = (e) => {
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            e.preventDefault();
            setIsPanning(true);
            setLastPanPoint({ x: e.clientX, y: e.clientY });
        }
    };

    const handleContainerMouseMove = (e) => {
        if (isPanning) {
            const dx = e.clientX - lastPanPoint.x;
            const dy = e.clientY - lastPanPoint.y;
            setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            setLastPanPoint({ x: e.clientX, y: e.clientY });
        }
    };

    const handleContainerMouseUp = () => {
        setIsPanning(false);
    };

    // --- Point Dragging Logic ---

    const getNaturalCoords = (clientX, clientY) => {
        if (!containerRef.current || imgSize.w === 0) return null;
        const rect = containerRef.current.getBoundingClientRect();

        const cx = rect.width / 2;
        const cy = rect.height / 2;

        const mx = clientX - rect.left - cx - pan.x;
        const my = clientY - rect.top - cy - pan.y;

        const unscaledX = mx / zoom;
        const unscaledY = my / zoom;

        const naturalX = unscaledX + (imgSize.w / 2);
        const naturalY = unscaledY + (imgSize.h / 2);

        return { x: naturalX, y: naturalY };
    };

    const handlePointMouseDown = (index, e) => {
        e.stopPropagation();
        e.preventDefault();
        setActivePointIndex(index);
    };

    const handleGlobalMouseMove = useCallback((e) => {
        if (activePointIndex !== null) {
            const coords = getNaturalCoords(e.clientX, e.clientY);
            if (!coords) return;

            const x = Math.max(0, Math.min(imgSize.w, coords.x));
            const y = Math.max(0, Math.min(imgSize.h, coords.y));

            setPoints(prev => {
                const newPoints = [...prev];
                newPoints[activePointIndex] = { x, y };
                return newPoints;
            });

            setMagnifierPos({ x: e.clientX, y: e.clientY, imgX: x, imgY: y });
        }
    }, [activePointIndex, imgSize, zoom, pan]);

    const handleGlobalMouseUp = () => {
        setActivePointIndex(null);
        setMagnifierPos(null);
    };

    useEffect(() => {
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [handleGlobalMouseMove]);


    // --- Processing ---

    const processImage = useCallback(() => {
        if (!imageSrc || !resultCanvasRef.current || imgSize.w === 0) return;

        setIsProcessing(true);

        setTimeout(() => {
            const canvas = resultCanvasRef.current;
            const ctx = canvas.getContext('2d');
            const { w, h } = outputSize;

            canvas.width = w;
            canvas.height = h;

            const dstPoints = [
                { x: 0, y: 0 },
                { x: w, y: 0 },
                { x: w, y: h },
                { x: 0, y: h }
            ];

            const H = getHomographyMatrix(points, dstPoints);
            const H_inv = inverseMatrix(H);

            if (!H_inv) {
                setIsProcessing(false);
                return;
            }

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imgSize.w;
            tempCanvas.height = imgSize.h;
            const tempCtx = tempCanvas.getContext('2d');
            const img = new Image();
            img.src = imageSrc;

            if (!img.complete) {
                img.onload = () => processImage();
                return;
            }

            tempCtx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
            tempCtx.drawImage(img, 0, 0);
            tempCtx.filter = 'none';

            const srcData = tempCtx.getImageData(0, 0, imgSize.w, imgSize.h);
            const srcPixels = srcData.data;

            const dstData = ctx.createImageData(w, h);
            const dstPixels = dstData.data;

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const D = H_inv[2][0] * x + H_inv[2][1] * y + H_inv[2][2];
                    const srcX = (H_inv[0][0] * x + H_inv[0][1] * y + H_inv[0][2]) / D;
                    const srcY = (H_inv[1][0] * x + H_inv[1][1] * y + H_inv[1][2]) / D;

                    if (srcX >= 0 && srcX < imgSize.w - 1 && srcY >= 0 && srcY < imgSize.h - 1) {
                        const x0 = Math.floor(srcX);
                        const x1 = x0 + 1;
                        const y0 = Math.floor(srcY);
                        const y1 = y0 + 1;

                        const dx = srcX - x0;
                        const dy = srcY - y0;

                        const i00 = (y0 * imgSize.w + x0) * 4;
                        const i10 = (y0 * imgSize.w + x1) * 4;
                        const i01 = (y1 * imgSize.w + x0) * 4;
                        const i11 = (y1 * imgSize.w + x1) * 4;

                        const dstIndex = (y * w + x) * 4;

                        for (let c = 0; c < 3; c++) {
                            const val =
                                srcPixels[i00 + c] * (1 - dx) * (1 - dy) +
                                srcPixels[i10 + c] * dx * (1 - dy) +
                                srcPixels[i01 + c] * (1 - dx) * dy +
                                srcPixels[i11 + c] * dx * dy;
                            dstPixels[dstIndex + c] = val;
                        }
                        dstPixels[dstIndex + 3] = 255;
                    }
                }
            }

            ctx.putImageData(dstData, 0, 0);

            // PBR Generation
            if (activeMap !== 'base') {
                let pbrData;
                if (activeMap === 'normal') {
                    pbrData = generateNormalMap(ctx, w, h, normalStrength);
                } else if (activeMap === 'roughness') {
                    pbrData = generateRoughnessMap(ctx, w, h, roughnessContrast, roughnessBrightness);
                } else if (activeMap === 'metallic') {
                    pbrData = generateMetallicMap(ctx, w, h, metallicThreshold);
                }
                if (pbrData) {
                    ctx.putImageData(pbrData, 0, 0);
                }
            }

            setIsProcessing(false);
        }, 10);
    }, [imageSrc, points, outputSize, imgSize, brightness, contrast, activeMap, normalStrength, roughnessContrast, roughnessBrightness, metallicThreshold]);

    useEffect(() => {
        const timer = setTimeout(() => {
            processImage();
        }, 100);
        return () => clearTimeout(timer);
    }, [processImage]);

    const handleDownload = () => {
        const canvas = resultCanvasRef.current;
        if (!canvas) return;
        const link = document.createElement('a');
        let ext = 'png';
        if (fileFormat === 'image/jpeg') ext = 'jpg';
        if (fileFormat === 'image/webp') ext = 'webp';
        if (fileFormat === 'image/avif') ext = 'avif';

        link.download = `texture_${activeMap}.${ext}`;
        link.href = canvas.toDataURL(fileFormat, quality);
        link.click();
    };

    // --- Render Helpers ---

    const transformStyle = {
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: 'center center',
        cursor: isPanning ? 'grabbing' : 'grab'
    };

    return (
        <div className="min-h-screen bg-brown-950 text-brown-100 font-sans flex flex-col h-screen overflow-hidden selection:bg-accent-DEFAULT selection:text-white">

            {/* Top Bar */}
            <header className="h-14 md:h-16 bg-brown-900 border-b border-brown-700 flex items-center justify-between px-4 z-20 flex-shrink-0 shadow-md">
                <div className="flex items-center gap-3">
                    <div className="bg-accent-DEFAULT w-4 h-4 md:w-5 md:h-5 shadow-lg shadow-accent-DEFAULT/20"></div>
                    <h1 className="text-sm md:text-lg font-bold text-brown-50 tracking-widest uppercase font-mono">Image to Texture</h1>
                </div>

                <div className="flex items-center gap-2 md:gap-3">
                    {imageSrc && (
                        <>
                            <div className="hidden md:flex items-center border border-brown-700 bg-brown-950">
                                <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} className="p-2 hover:bg-brown-800 text-brown-400 hover:text-brown-200 border-r border-brown-700"><ZoomOut size={14} /></button>
                                <span className="text-xs font-mono w-10 text-center text-brown-400">{Math.round(zoom * 100)}%</span>
                                <button onClick={() => setZoom(z => Math.min(5, z + 0.1))} className="p-2 hover:bg-brown-800 text-brown-400 hover:text-brown-200 border-l border-brown-700"><ZoomIn size={14} /></button>
                            </div>
                            <button
                                onClick={handleAutoDetect}
                                className="p-2 border border-brown-700 text-brown-400 hover:bg-brown-800 hover:text-accent-DEFAULT flex items-center gap-2"
                                title="Auto Detect Corners"
                            >
                                <Scan size={16} />
                                <span className="hidden md:inline text-xs font-bold">AUTO</span>
                            </button>
                            <button
                                onClick={() => setShowGrid(!showGrid)}
                                className={`p-2 border transition-colors ${showGrid ? 'bg-brown-800 border-accent-DEFAULT text-accent-DEFAULT' : 'border-brown-700 text-brown-400 hover:bg-brown-800'}`}
                                title="Toggle Grid"
                            >
                                <Grid size={16} />
                            </button>
                            <button
                                onClick={handleReset}
                                className="p-2 border border-brown-700 text-brown-400 hover:bg-brown-800 hover:text-brown-200"
                                title="Reset View"
                            >
                                <RotateCcw size={16} />
                            </button>
                        </>
                    )}
                </div>
            </header>

            {/* Main Workspace */}
            <div className="flex-grow flex flex-col md:flex-row overflow-hidden">

                {/* Editor Canvas */}
                <div className="flex-grow relative bg-[#0c0a09] overflow-hidden order-1 md:order-2 h-[50vh] md:h-auto"
                    onWheel={handleWheel}
                    onMouseDown={handleContainerMouseDown}
                    onMouseMove={handleContainerMouseMove}
                    onMouseUp={handleContainerMouseUp}
                    onMouseLeave={handleContainerMouseUp}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFileUpload}
                >
                    {/* Retro Grid Background */}
                    <div className="absolute inset-0 opacity-10 pointer-events-none"
                        style={{
                            backgroundImage: 'linear-gradient(#44403c 1px, transparent 1px), linear-gradient(90deg, #44403c 1px, transparent 1px)',
                            backgroundSize: '40px 40px'
                        }}
                    />
                    <div className="absolute inset-0 opacity-5 pointer-events-none"
                        style={{
                            backgroundImage: 'linear-gradient(#44403c 1px, transparent 1px), linear-gradient(90deg, #44403c 1px, transparent 1px)',
                            backgroundSize: '10px 10px'
                        }}
                    />

                    {!imageSrc ? (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center p-8 border border-brown-800 bg-brown-900/50 backdrop-blur-sm">
                                <Upload className="w-8 h-8 text-brown-600 mx-auto mb-4" />
                                <h3 className="text-sm font-bold text-brown-400 mb-2 tracking-widest">SYSTEM READY</h3>
                                <p className="text-brown-600 text-xs font-mono">DROP IMAGE FILE TO INITIATE</p>
                            </div>
                        </div>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center" ref={containerRef}>
                            <div style={transformStyle} className="relative shadow-2xl">
                                <img
                                    ref={imageRef}
                                    src={imageSrc}
                                    alt="Source"
                                    onLoad={handleImageLoad}
                                    className="max-w-none block select-none pointer-events-none shadow-2xl border border-brown-800"
                                    style={{ filter: `brightness(${brightness}%) contrast(${contrast}%)` }}
                                />

                                {/* SVG Overlay */}
                                {imgSize.w > 0 && activeMap === 'base' && (
                                    <svg
                                        className="absolute top-0 left-0 w-full h-full overflow-visible"
                                        viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
                                        style={{ pointerEvents: 'none' }}
                                    >
                                        {showGrid && (
                                            <>
                                                <line x1={points[0].x} y1={points[0].y} x2={points[2].x} y2={points[2].y} stroke="rgba(217, 119, 6, 0.5)" strokeWidth={1 / zoom} strokeDasharray="2,2" />
                                                <line x1={points[1].x} y1={points[1].y} x2={points[3].x} y2={points[3].y} stroke="rgba(217, 119, 6, 0.5)" strokeWidth={1 / zoom} strokeDasharray="2,2" />
                                            </>
                                        )}

                                        <path
                                            d={`M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y} L ${points[2].x} ${points[2].y} L ${points[3].x} ${points[3].y} Z`}
                                            fill="rgba(217, 119, 6, 0.1)"
                                            stroke="#d97706"
                                            strokeWidth={1 / zoom}
                                        />

                                        {points.map((p, i) => (
                                            <g key={i} transform={`translate(${p.x}, ${p.y})`}>
                                                <line x1={-10 / zoom} y1={0} x2={10 / zoom} y2={0} stroke="#d97706" strokeWidth={2 / zoom} />
                                                <line x1={0} y1={-10 / zoom} x2={0} y2={10 / zoom} stroke="#d97706" strokeWidth={2 / zoom} />
                                                <rect
                                                    x={-4 / zoom} y={-4 / zoom} width={8 / zoom} height={8 / zoom}
                                                    fill="transparent"
                                                    stroke="#d97706"
                                                    strokeWidth={1 / zoom}
                                                    className="pointer-events-auto cursor-move hover:fill-accent-DEFAULT/50"
                                                    onMouseDown={(e) => handlePointMouseDown(i, e)}
                                                />
                                                <text
                                                    y={-12 / zoom}
                                                    x={12 / zoom}
                                                    fill="#d97706"
                                                    fontSize={10 / zoom}
                                                    fontFamily="monospace"
                                                    fontWeight="bold"
                                                    style={{ textShadow: '1px 1px 0px #000' }}
                                                >
                                                    {['TL', 'TR', 'BR', 'BL'][i]}
                                                </text>
                                            </g>
                                        ))}
                                    </svg>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Magnifier */}
                    {magnifierPos && imageSrc && activeMap === 'base' && (
                        <div
                            className="absolute pointer-events-none z-50 border border-accent-DEFAULT overflow-hidden shadow-2xl bg-black"
                            style={{
                                left: magnifierPos.x + 20,
                                top: magnifierPos.y - 80,
                                width: '128px',
                                height: '128px',
                            }}
                        >
                            <div
                                className="relative w-full h-full image-pixelated"
                                style={{
                                    backgroundImage: `url(${imageSrc})`,
                                    backgroundPosition: `-${magnifierPos.imgX * 4 - 64}px -${magnifierPos.imgY * 4 - 64}px`,
                                    backgroundSize: `${imgSize.w * 4}px ${imgSize.h * 4}px`,
                                    filter: `brightness(${brightness}%) contrast(${contrast}%)`
                                }}
                            >
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-full h-[1px] bg-accent-DEFAULT"></div>
                                    <div className="h-full w-[1px] bg-accent-DEFAULT absolute"></div>
                                </div>
                                <div className="absolute bottom-1 right-1 text-[8px] text-accent-DEFAULT bg-black/50 px-1 font-mono">
                                    x4
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Left Sidebar */}
                <aside className="w-full md:w-80 bg-brown-900 border-t md:border-t-0 md:border-r border-brown-700 flex flex-col z-10 flex-shrink-0 order-2 md:order-1 h-[50vh] md:h-auto">

                    <div className="flex-grow overflow-y-auto p-3 space-y-4 custom-scrollbar">

                        {/* Input */}
                        <div className="space-y-1">
                            <div className="text-[10px] text-brown-500 uppercase tracking-widest mb-1 pl-1">Source</div>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full flex items-center justify-center gap-2 bg-brown-800 hover:bg-brown-700 text-brown-200 py-2 px-3 border border-brown-700 transition-colors text-xs hover:border-accent-DEFAULT group"
                            >
                                <Upload size={14} className="group-hover:text-accent-DEFAULT transition-colors" />
                                {imageSrc ? 'CHANGE IMAGE' : 'OPEN IMAGE'}
                            </button>
                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                        </div>

                        {/* Preview & Map Switching */}
                        <div className="space-y-2">
                            <div className="flex justify-between text-[10px] text-brown-500 uppercase tracking-widest pl-1">
                                Preview
                            </div>

                            <div className="grid grid-cols-4 gap-0.5 bg-brown-950 border border-brown-700 p-0.5">
                                {[
                                    { id: 'base', icon: ImageIcon, label: 'BASE' },
                                    { id: 'normal', icon: Layers, label: 'NRM' },
                                    { id: 'roughness', icon: Droplet, label: 'RGH' },
                                    { id: 'metallic', icon: Zap, label: 'MTL' }
                                ].map(map => (
                                    <button
                                        key={map.id}
                                        onClick={() => setActiveMap(map.id)}
                                        className={`flex flex-col items-center justify-center py-2 text-[10px] gap-1 transition-colors ${activeMap === map.id ? 'bg-accent-DEFAULT text-white' : 'text-brown-500 hover:text-brown-300 hover:bg-brown-800'}`}
                                        title={map.label}
                                    >
                                        <map.icon size={14} />
                                        <span className="font-mono">{map.label}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="w-full aspect-square bg-[#050403] border border-brown-700 flex items-center justify-center overflow-hidden relative group">
                                <div className="absolute inset-0 opacity-20"
                                    style={{
                                        backgroundImage: 'linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)',
                                        backgroundSize: '10px 10px'
                                    }}
                                />

                                {imageSrc ? (
                                    <canvas ref={resultCanvasRef} className="max-w-full max-h-full object-contain relative z-10 image-pixelated" />
                                ) : (
                                    <div className="text-brown-700 text-[10px] text-center px-4 font-mono">
                                        NO SIGNAL
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Adjustments */}
                        <div className={!imageSrc ? 'opacity-50 pointer-events-none' : ''}>
                            <CollapsibleSection title="Map Settings" icon={Settings} defaultOpen={true}>
                                <div className="space-y-3">

                                    {activeMap === 'base' && (
                                        <>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="flex items-center gap-1 text-brown-400"><Sun size={10} /> BRIGHTNESS</span>
                                                    <span className="text-accent-DEFAULT font-mono">{brightness}%</span>
                                                </div>
                                                <input
                                                    type="range" min="50" max="150" value={brightness}
                                                    onChange={(e) => setBrightness(parseInt(e.target.value))}
                                                    className="w-full h-1 bg-brown-950 rounded-none appearance-none cursor-pointer border border-brown-700"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="flex items-center gap-1 text-brown-400"><Contrast size={10} /> CONTRAST</span>
                                                    <span className="text-accent-DEFAULT font-mono">{contrast}%</span>
                                                </div>
                                                <input
                                                    type="range" min="50" max="150" value={contrast}
                                                    onChange={(e) => setContrast(parseInt(e.target.value))}
                                                    className="w-full h-1 bg-brown-950 rounded-none appearance-none cursor-pointer border border-brown-700"
                                                />
                                            </div>
                                        </>
                                    )}

                                    {activeMap === 'normal' && (
                                        <div className="space-y-1">
                                            <div className="flex justify-between text-[10px]">
                                                <span className="flex items-center gap-1 text-brown-400">STRENGTH</span>
                                                <span className="text-accent-DEFAULT font-mono">{normalStrength.toFixed(1)}</span>
                                            </div>
                                            <input
                                                type="range" min="0.1" max="5.0" step="0.1" value={normalStrength}
                                                onChange={(e) => setNormalStrength(parseFloat(e.target.value))}
                                                className="w-full h-1 bg-brown-950 rounded-none appearance-none cursor-pointer border border-brown-700"
                                            />
                                        </div>
                                    )}

                                    {activeMap === 'roughness' && (
                                        <>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="flex items-center gap-1 text-brown-400">CONTRAST</span>
                                                    <span className="text-accent-DEFAULT font-mono">{roughnessContrast}%</span>
                                                </div>
                                                <input
                                                    type="range" min="0" max="200" value={roughnessContrast}
                                                    onChange={(e) => setRoughnessContrast(parseInt(e.target.value))}
                                                    className="w-full h-1 bg-brown-950 rounded-none appearance-none cursor-pointer border border-brown-700"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="flex items-center gap-1 text-brown-400">BRIGHTNESS</span>
                                                    <span className="text-accent-DEFAULT font-mono">{roughnessBrightness}%</span>
                                                </div>
                                                <input
                                                    type="range" min="0" max="200" value={roughnessBrightness}
                                                    onChange={(e) => setRoughnessBrightness(parseInt(e.target.value))}
                                                    className="w-full h-1 bg-brown-950 rounded-none appearance-none cursor-pointer border border-brown-700"
                                                />
                                            </div>
                                        </>
                                    )}

                                    {activeMap === 'metallic' && (
                                        <div className="space-y-1">
                                            <div className="flex justify-between text-[10px]">
                                                <span className="flex items-center gap-1 text-brown-400">THRESHOLD</span>
                                                <span className="text-accent-DEFAULT font-mono">{metallicThreshold}</span>
                                            </div>
                                            <input
                                                type="range" min="0" max="255" value={metallicThreshold}
                                                onChange={(e) => setMetallicThreshold(parseInt(e.target.value))}
                                                className="w-full h-1 bg-brown-950 rounded-none appearance-none cursor-pointer border border-brown-700"
                                            />
                                        </div>
                                    )}

                                </div>
                            </CollapsibleSection>
                        </div>

                        {/* Output Settings */}
                        <div className={!imageSrc ? 'opacity-50 pointer-events-none' : ''}>
                            <CollapsibleSection title="Output Settings" icon={Box} defaultOpen={false}>
                                <div className="space-y-3">

                                    {/* Width Slider */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px]">
                                            <span className="text-brown-400">WIDTH</span>
                                            <span className="text-brown-200 font-mono">{outputSize.w}px</span>
                                        </div>
                                        <input
                                            type="range" min="64" max="4096" step="64" value={outputSize.w}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (lockAspectRatio) {
                                                    const ratio = outputSize.h / outputSize.w;
                                                    setOutputSize({ w: val, h: Math.round(val * ratio) });
                                                } else {
                                                    setOutputSize({ ...outputSize, w: val });
                                                }
                                            }}
                                            className="w-full h-1 bg-brown-950 rounded-none appearance-none cursor-pointer border border-brown-700"
                                        />
                                    </div>

                                    {/* Height Slider */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px]">
                                            <span className="text-brown-400">HEIGHT</span>
                                            <span className="text-brown-200 font-mono">{outputSize.h}px</span>
                                        </div>
                                        <input
                                            type="range" min="64" max="4096" step="64" value={outputSize.h}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (lockAspectRatio) {
                                                    const ratio = outputSize.w / outputSize.h;
                                                    setOutputSize({ h: val, w: Math.round(val * ratio) });
                                                } else {
                                                    setOutputSize({ ...outputSize, h: val });
                                                }
                                            }}
                                            className="w-full h-1 bg-brown-950 rounded-none appearance-none cursor-pointer border border-brown-700"
                                        />
                                    </div>

                                    <button
                                        onClick={() => setLockAspectRatio(!lockAspectRatio)}
                                        className={`w-full flex items-center justify-center gap-2 py-1.5 border text-[10px] transition-colors ${lockAspectRatio ? 'bg-brown-800 border-accent-DEFAULT text-accent-DEFAULT' : 'border-brown-700 text-brown-500 hover:text-brown-300'}`}
                                    >
                                        {lockAspectRatio ? <Lock size={10} /> : <Unlock size={10} />}
                                        {lockAspectRatio ? 'ASPECT LOCKED' : 'LOCK ASPECT'}
                                    </button>

                                    <div className="pt-1">
                                        <label className="text-[10px] text-brown-500 block mb-1">FORMAT</label>
                                        <div className="grid grid-cols-2 gap-1">
                                            {['image/png', 'image/jpeg', 'image/webp', 'image/avif'].map(fmt => (
                                                <button
                                                    key={fmt}
                                                    onClick={() => setFileFormat(fmt)}
                                                    className={`text-[10px] py-1 border ${fileFormat === fmt ? 'bg-accent-DEFAULT text-white border-accent-DEFAULT' : 'bg-brown-950 text-brown-400 border-brown-700 hover:border-brown-500'}`}
                                                >
                                                    {fmt.split('/')[1].toUpperCase()}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </CollapsibleSection>
                        </div>
                    </div>

                    {/* Download Button */}
                    <div className="p-3 border-t border-brown-700 bg-brown-900">
                        <button
                            onClick={handleDownload}
                            disabled={!imageSrc}
                            className={`w-full font-bold py-3 px-4 shadow-lg flex items-center justify-center gap-2 transition-all transform border ${imageSrc ? 'bg-accent-DEFAULT border-accent-light text-white hover:bg-accent-hover' : 'bg-brown-800 border-brown-700 text-brown-600 cursor-not-allowed'}`}
                        >
                            <Download className="w-4 h-4" />
                            EXPORT {activeMap.toUpperCase()}
                        </button>
                    </div>
                </aside>
            </div>
        </div>
    );
}
