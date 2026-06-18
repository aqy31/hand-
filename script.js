const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

const colorPicker = document.getElementById('colorPicker');
const lineWidthInput = document.getElementById('lineWidth');
const clearBtn = document.getElementById('clearBtn');
const statusDiv = document.getElementById('status');
const cursor = document.getElementById('cursor');

// Set canvas to full screen
function resizeCanvas() {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Drawing State
let isDrawing = false;
let lastX = 0;
let lastY = 0;

// Smoothing State
let currentX = null;
let currentY = null;
const SMOOTHING_FACTOR = 0.15; // Lower = smoother and slower

// Setup clear button
clearBtn.addEventListener('click', () => {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
});

// Calculate distance between two points
function calculateDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Check if hand is a fist (all fingers folded)
function isFist(landmarks) {
    const wrist = landmarks[0];
    
    // Helper to check if a finger tip is closer to wrist than its MCP joint
    const isFolded = (tipIdx, mcpIdx) => {
        return calculateDistance(landmarks[tipIdx], wrist) < calculateDistance(landmarks[mcpIdx], wrist);
    };
    
    // Index (8,5), Middle (12,9), Ring (16,13), Pinky (20,17)
    return isFolded(8, 5) && isFolded(12, 9) && isFolded(16, 13) && isFolded(20, 17);
}

// Handle Hand Tracking Results
function onResults(results) {
    // Only clear canvas if we want to redraw the video frame. 
    // Here we DO NOT clear the canvas on every frame so we can draw persistent lines.
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // Get the first hand
        const landmarks = results.multiHandLandmarks[0];
        
        // Landmark 8 is Index Finger Tip
        // Landmark 4 is Thumb Tip
        const indexFinger = landmarks[8];
        const thumb = landmarks[4];
        
        // Check if fist is closed to clear screen
        if (isFist(landmarks)) {
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            statusDiv.textContent = 'تم مسح الشاشة!';
            setTimeout(() => {
                if(statusDiv.textContent === 'تم مسح الشاشة!') {
                    statusDiv.textContent = 'جاهز للرسم! (قرّب الإبهام من السبابة للرسم)';
                }
            }, 1000);
        }
        
        // Target positions
        const targetX = (1 - indexFinger.x) * canvasElement.width;
        const targetY = indexFinger.y * canvasElement.height;
        
        // Apply smoothing (Linear Interpolation)
        if (currentX === null || currentY === null) {
            currentX = targetX;
            currentY = targetY;
        } else {
            currentX += (targetX - currentX) * SMOOTHING_FACTOR;
            currentY += (targetY - currentY) * SMOOTHING_FACTOR;
        }
        
        const x = currentX;
        const y = currentY;
        
        // Update cursor
        cursor.style.display = 'block';
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
        cursor.style.borderColor = colorPicker.value;
        
        // Check pinch distance to determine "pen down" or "pen up"
        const distance = calculateDistance(indexFinger, thumb);
        const pinchThreshold = 0.08; // Adjust this threshold based on testing
        
        if (distance < pinchThreshold) {
            cursor.style.backgroundColor = colorPicker.value; // Filled circle when drawing
            
            if (!isDrawing) {
                // Start a new line
                isDrawing = true;
                lastX = x;
                lastY = y;
            }
            
            // Draw line
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
            // Stop drawing
            isDrawing = false;
            cursor.style.backgroundColor = 'transparent'; // Hollow circle when hovering
        }
        
    } else {
        isDrawing = false;
        cursor.style.display = 'none';
        currentX = null;
        currentY = null;
    }
}

// Initialize MediaPipe Hands
const hands = new Hands({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});
hands.onResults(onResults);

// Start Webcam and loop
async function startWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: "user",
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });
        videoElement.srcObject = stream;
        
        // Wait for video to be ready
        videoElement.onloadedmetadata = () => {
            videoElement.play();
            statusDiv.textContent = 'جاهز للرسم! (قرّب الإبهام من السبابة للرسم)';
            statusDiv.className = 'status-indicator ready';
            
            // Start processing frames
            processVideoFrame();
        };
    } catch (err) {
        console.error("Error accessing webcam: ", err);
        statusDiv.textContent = 'خطأ: يرجى إعطاء صلاحية الكاميرا والمحاولة مجدداً.';
        statusDiv.className = 'status-indicator error';
    }
}

async function processVideoFrame() {
    if (videoElement.readyState >= 2) {
        await hands.send({image: videoElement});
    }
    requestAnimationFrame(processVideoFrame);
}

// Start everything
startWebcam();
