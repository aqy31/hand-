// --- On-Screen Error Logging for Mobile Debugging ---
window.addEventListener('error', function(e) {
    const errorDiv = document.getElementById('debug-error-console') || document.createElement('div');
    errorDiv.id = 'debug-error-console';
    errorDiv.style.position = 'fixed';
    errorDiv.style.bottom = '10px';
    errorDiv.style.left = '10px';
    errorDiv.style.right = '10px';
    errorDiv.style.background = 'rgba(220, 38, 38, 0.95)';
    errorDiv.style.color = 'white';
    errorDiv.style.padding = '12px';
    errorDiv.style.borderRadius = '8px';
    errorDiv.style.zIndex = '10000';
    errorDiv.style.fontSize = '12px';
    errorDiv.style.fontFamily = 'monospace';
    errorDiv.style.maxHeight = '150px';
    errorDiv.style.overflowY = 'auto';
    errorDiv.style.border = '1px solid #fca5a5';
    errorDiv.innerText = `Error: ${e.message}\nAt: ${e.filename}:${e.lineno}`;
    document.body.appendChild(errorDiv);
});

// --- UI and State Management ---
const homeScreen = document.getElementById('home_screen');
const drawingMode = document.getElementById('drawing_mode');
const mode3d = document.getElementById('3d_mode');
const modeAr = document.getElementById('ar_mode');
const threejsContainer = document.getElementById('threejs_container');

const btnDrawing = document.getElementById('btn_drawing');
const btn3d = document.getElementById('btn_3d');
const btnAr = document.getElementById('btn_ar');

const backFromDrawing = document.getElementById('back_from_drawing');
const backFrom3d = document.getElementById('back_from_3d');
const backFromAr = document.getElementById('back_from_ar');

let currentMode = 'home'; // 'home', 'drawing', '3d', 'ar'
let currentFacingMode = 'user'; // 'user' (front) or 'environment' (back)
let activeFacingMode = 'user';
let smoothedLandmarks = null;
const LANDMARK_SMOOTHING = 0.25; // Butter-smooth filtering factor to remove camera jitter

function showScreen(screen) {
    homeScreen.classList.remove('active');
    drawingMode.classList.remove('active');
    mode3d.classList.remove('active');
    modeAr.classList.remove('active');
    
    // Manage ThreeJS container visibility
    if (screen === '3d' || screen === 'ar') {
        threejsContainer.style.display = 'block';
    } else {
        threejsContainer.style.display = 'none';
        if (loadedModel) loadedModel.visible = false;
    }
    
    // Manage AR Video Background
    if (screen === 'ar') {
        videoElement.classList.add('ar-video');
    } else {
        videoElement.classList.remove('ar-video');
    }
    updateVideoMirror();
    
    if(screen === 'home') homeScreen.classList.add('active');
    if(screen === 'drawing') drawingMode.classList.add('active');
    if(screen === '3d') mode3d.classList.add('active');
    if(screen === 'ar') modeAr.classList.add('active');
    
    currentMode = screen;
}

function updateVideoMirror() {
    if (activeFacingMode === 'user') {
        videoElement.classList.add('mirrored');
    } else {
        videoElement.classList.remove('mirrored');
    }
}

btnDrawing.addEventListener('click', () => {
    if (currentFacingMode !== 'user') {
        currentFacingMode = 'user';
        updateVideoMirror();
        startWebcam(true);
    } else if (!isWebcamStarted) {
        startWebcam();
    }
    showScreen('drawing');
});

btn3d.addEventListener('click', () => {
    if (currentFacingMode !== 'user') {
        currentFacingMode = 'user';
        updateVideoMirror();
        startWebcam(true);
    } else if (!isWebcamStarted) {
        startWebcam();
    }
    showScreen('3d');
    if (!isThreeJsInitialized) initThreeJs();
});

btnAr.addEventListener('click', () => {
    // Default to back camera for AR mode to see the floor/environment
    if (currentFacingMode !== 'environment') {
        currentFacingMode = 'environment';
        updateVideoMirror();
        startWebcam(true);
    } else if (!isWebcamStarted) {
        startWebcam();
    }
    showScreen('ar');
    if (!isThreeJsInitialized) initThreeJs();
});

backFromDrawing.addEventListener('click', () => showScreen('home'));
backFrom3d.addEventListener('click', () => showScreen('home'));
backFromAr.addEventListener('click', () => showScreen('home'));

// --- Webcam and MediaPipe Shared Setup ---
const videoElement = document.getElementById('webcam');
const statusHome = document.getElementById('status_home');
const statusDrawing = document.getElementById('status_drawing');
const status3d = document.getElementById('status_3d');
const statusAr = document.getElementById('status_ar');
let isWebcamStarted = false;
let currentStream = null;

function updateStatus(msg, type) {
    [statusDrawing, status3d, statusAr].forEach(el => {
        if(el) {
            el.textContent = msg;
            el.className = `status-indicator ${type}`;
        }
    });
}

function calculateDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function calculateDistance3D(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = p1.z - p2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isFist(landmarks) {
    const wrist = landmarks[0];
    const isFolded = (tipIdx, mcpIdx) => {
        // Use 3D distance and 0.85 tolerance to prevent false-positives when hand is open but tilted
        return calculateDistance3D(landmarks[tipIdx], wrist) < calculateDistance3D(landmarks[mcpIdx], wrist) * 0.85;
    };
    return isFolded(8, 5) && isFolded(12, 9) && isFolded(16, 13) && isFolded(20, 17);
}

// --- Drawing Mode Logic ---
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const lineWidthInput = document.getElementById('lineWidth');
const clearBtn = document.getElementById('clearBtn');
const cursor = document.getElementById('cursor');

let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentX = null;
let currentY = null;
const SMOOTHING_FACTOR = 0.15;

function resizeCanvas() {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

clearBtn.addEventListener('click', () => {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
});

function handleDrawingMode(landmarks) {
    const indexFinger = landmarks[8];
    const thumb = landmarks[4];
    
    if (isFist(landmarks)) {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        updateStatus('تم مسح الشاشة!', 'ready');
        setTimeout(() => {
            if(statusDrawing.textContent === 'تم مسح الشاشة!') {
                updateStatus('جاهز للرسم! (قرّب الإبهام من السبابة للرسم)', 'ready');
            }
        }, 1000);
    }
    
    // Calculate position based on video mirroring
    const isMirrored = videoElement.classList.contains('mirrored');
    const targetX = isMirrored ? ((1 - indexFinger.x) * canvasElement.width) : (indexFinger.x * canvasElement.width);
    const targetY = indexFinger.y * canvasElement.height;
    
    if (currentX === null || currentY === null) {
        currentX = targetX;
        currentY = targetY;
    } else {
        currentX += (targetX - currentX) * SMOOTHING_FACTOR;
        currentY += (targetY - currentY) * SMOOTHING_FACTOR;
    }
    
    const x = currentX;
    const y = currentY;
    
    cursor.style.display = 'block';
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
    cursor.style.borderColor = colorPicker.value;
    
    const distance = calculateDistance(indexFinger, thumb);
    const pinchThreshold = 0.08;
    
    if (distance < pinchThreshold) {
        cursor.style.backgroundColor = colorPicker.value;
        if (!isDrawing) {
            isDrawing = true;
            lastX = x;
            lastY = y;
        }
        canvasCtx.beginPath();
        canvasCtx.moveTo(lastX, lastY);
        canvasCtx.lineTo(x, y);
        canvasCtx.strokeStyle = colorPicker.value;
        canvasCtx.lineWidth = lineWidthInput.value;
        canvasCtx.lineCap = 'round';
        canvasCtx.stroke();
        lastX = x;
        lastY = y;
    } else {
        isDrawing = false;
        cursor.style.backgroundColor = 'transparent';
    }
}

function resetDrawingState() {
    isDrawing = false;
    cursor.style.display = 'none';
    currentX = null;
    currentY = null;
}

// --- 3D & AR Mode Logic (Three.js) ---
let isThreeJsInitialized = false;
let scene, camera, renderer, loadedModel;
let targetModelX = 0;
let targetModelY = 0;
let currentModelX = 0;
let currentModelY = 0;

let targetQuaternion = new THREE.Quaternion();
let currentQuaternion = new THREE.Quaternion();

let targetScale = 1;
let currentScale = 1;

function initThreeJs() {
    isThreeJsInitialized = true;
    
    scene = new THREE.Scene();
    scene.background = null; 

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 10;

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    threejsContainer.appendChild(renderer.domElement);

    // Better Lighting to see shape clearly
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
    scene.add(hemiLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.0);
    directionalLight.position.set(5, 10, 10);
    scene.add(directionalLight);
    
    const fillLight = new THREE.DirectionalLight(0xffffff, 1.0);
    fillLight.position.set(-5, 0, -5);
    scene.add(fillLight);

    const loader = new THREE.GLTFLoader();
    updateStatus('جاري تحميل المجسم (qwqee.glb)...', 'loading');
    
    loader.load(
        'qwqee.glb',
        function (gltf) {
            loadedModel = gltf.scene;
            
            const box = new THREE.Box3().setFromObject(loadedModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            
            const normalizedScale = 3 / maxDim;
            loadedModel.scale.set(normalizedScale, normalizedScale, normalizedScale);
            
            loadedModel.position.x = -center.x * normalizedScale;
            loadedModel.position.y = -center.y * normalizedScale;
            loadedModel.position.z = -center.z * normalizedScale;
            
            const wrapper = new THREE.Group();
            wrapper.add(loadedModel);
            wrapper.visible = false;
            
            scene.add(wrapper);
            loadedModel = wrapper; 

            updateStatus('جاهز! حرّك يدك للتحكم بالمجسم.', 'ready');
        },
        undefined,
        function (error) {
            console.error(error);
            updateStatus('لم يتم العثور على ملف qwqee.glb.', 'error');
        }
    );

    window.addEventListener('resize', () => {
        if(currentMode === '3d' || currentMode === 'ar') {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    });

    animateThreeJs();
}

function animateThreeJs() {
    requestAnimationFrame(animateThreeJs);
    
    const is3dMode = currentMode === '3d' || currentMode === 'ar';
    
    if (loadedModel && is3dMode && loadedModel.visible) {
        currentModelX += (targetModelX - currentModelX) * 0.2; // Slightly faster position tracking
        currentModelY += (targetModelY - currentModelY) * 0.2;
        loadedModel.position.x = currentModelX;
        loadedModel.position.y = currentModelY;
        
        currentQuaternion.slerp(targetQuaternion, 0.15); // Snappy, responsive rotation tracking
        loadedModel.quaternion.copy(currentQuaternion);
        
        currentScale += (targetScale - currentScale) * 0.2;
        loadedModel.scale.set(currentScale, currentScale, currentScale);
        
        renderer.render(scene, camera);
    } else if (loadedModel && is3dMode && !loadedModel.visible) {
        renderer.render(scene, camera);
    }
}

function handle3DMode(landmarks) {
    if (!loadedModel) return;
    
    if (isFist(landmarks)) {
        loadedModel.visible = false;
        return;
    } else {
        loadedModel.visible = true;
    }
    
    const wrist = landmarks[0];
    const indexMcp = landmarks[5];
    const middleMcp = landmarks[9];
    const pinkyMcp = landmarks[17];
    
    // Anchor at the exact center of the palm (averaging wrist and base knuckles)
    // This places the model deep and centered inside the palm as if being held
    const palmX = (wrist.x + indexMcp.x + middleMcp.x + pinkyMcp.x) / 4;
    const palmY = (wrist.y + indexMcp.y + middleMcp.y + pinkyMcp.y) / 4;
    
    // Check if the video is currently mirrored
    const isMirrored = videoElement.classList.contains('mirrored');
    
    // Calculate X coordinate in Normalized Device Coordinates (NDC)
    // If mirrored, flip the X axis. If not, use standard mapping.
    const ndcX = isMirrored ? (((1 - palmX) * 2) - 1) : ((palmX * 2) - 1);
    const ndcY = -(palmY * 2) + 1;
    
    const vector = new THREE.Vector3(ndcX, ndcY, 0.5);
    vector.unproject(camera);
    const dir = vector.sub(camera.position).normalize();
    const distance = -camera.position.z / dir.z;
    const pos = camera.position.clone().add(dir.multiplyScalar(distance));
    
    // Model tracks the hand in BOTH 3D and AR modes
    targetModelX = pos.x;
    targetModelY = pos.y;
    
    // Scale: Use the rigid palm length (wrist to middle finger MCP)
    // This keeps the size completely stable and prevents shrinking when curling fingers
    const palmLength = calculateDistance3D(wrist, middleMcp);
    targetScale = Math.max(0.15, palmLength * 4.5); // Fits snugly inside the palm
    
    // Flip the sign of relative X components for direction vectors if mirrored
    const xSign = isMirrored ? -1 : 1;
    const zScale = 4.0; // Amplify Z depth difference to enable full 3D rotation feel
    
    const vUp = new THREE.Vector3(
        xSign * (middleMcp.x - wrist.x), 
        -(middleMcp.y - wrist.y), 
        -zScale * (middleMcp.z - wrist.z)
    ).normalize();
    
    const vRight = new THREE.Vector3(
        xSign * (pinkyMcp.x - indexMcp.x), 
        -(pinkyMcp.y - indexMcp.y), 
        -zScale * (pinkyMcp.z - indexMcp.z)
    ).normalize();
    
    const vForward = new THREE.Vector3().crossVectors(vRight, vUp).normalize();
    vRight.crossVectors(vUp, vForward).normalize();
    
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(vRight, vUp, vForward);
    
    targetQuaternion.setFromRotationMatrix(matrix);
}

// --- MediaPipe Hand Tracking Setup ---
const hands = new Hands({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});

hands.onResults((results) => {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // Apply Exponential Moving Average (EMA) to landmarks to eliminate camera jitter at source
        if (!smoothedLandmarks) {
            smoothedLandmarks = landmarks.map(l => ({ x: l.x, y: l.y, z: l.z }));
        } else {
            for (let i = 0; i < 21; i++) {
                smoothedLandmarks[i].x += (landmarks[i].x - smoothedLandmarks[i].x) * LANDMARK_SMOOTHING;
                smoothedLandmarks[i].y += (landmarks[i].y - smoothedLandmarks[i].y) * LANDMARK_SMOOTHING;
                smoothedLandmarks[i].z += (landmarks[i].z - smoothedLandmarks[i].z) * LANDMARK_SMOOTHING;
            }
        }
        
        if (currentMode === 'drawing') {
            handleDrawingMode(smoothedLandmarks);
        } else if (currentMode === '3d' || currentMode === 'ar') {
            handle3DMode(smoothedLandmarks);
        }
    } else {
        smoothedLandmarks = null;
        if (currentMode === 'drawing') {
            resetDrawingState();
        } else if ((currentMode === '3d' || currentMode === 'ar') && loadedModel) {
            loadedModel.visible = false;
        }
    }
});

// --- Start Video processing ---
let processingFrame = false;

async function startWebcam(forceRestart = false) {
    if (isWebcamStarted && !forceRestart) return;
    
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }
    
    updateStatus('جاري تشغيل الكاميرا...', 'loading');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: { ideal: currentFacingMode },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });
        isWebcamStarted = true;
        currentStream = stream;
        videoElement.srcObject = stream;
        
        // Query active facingMode from stream track settings
        const track = stream.getVideoTracks()[0];
        const settings = track && track.getSettings ? track.getSettings() : {};
        activeFacingMode = settings.facingMode || currentFacingMode;
        updateVideoMirror();
        
        videoElement.onloadedmetadata = () => {
            videoElement.play();
            updateStatus('جاهز للاستخدام!', 'ready');
            if (!processingFrame) {
                processingFrame = true;
                processVideoFrame();
            }
        };
    } catch (err) {
        console.error("Error accessing webcam: ", err);
        updateStatus('خطأ: يرجى إعطاء صلاحية الكاميرا والمحاولة مجدداً.', 'error');
    }
}

async function processVideoFrame() {
    if (videoElement.readyState >= 2) {
        await hands.send({image: videoElement});
    }
    requestAnimationFrame(processVideoFrame);
}
