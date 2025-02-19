import "./style.css";

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { pipeline, env, RawImage } from "@xenova/transformers";

// Since we will download the model from the Hugging Face Hub, we can skip the local model check
env.allowLocalModels = false;

// Proxy the WASM backend to prevent the UI from freezing
env.backends.onnx.wasm.proxy = true;

// Constants
const EXAMPLE_URL =
  "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/bread_small.png";
const DEFAULT_SCALE = 0.75;

// Reference the elements that we will need
const status = document.getElementById("status");
const fileUpload = document.getElementById("upload");
const imageContainer = document.getElementById("three-container");
const depthContainer = document.getElementById("depth-container");
const example = document.getElementById("example");

// Create a new depth-estimation pipeline
status.textContent = "Loading model...";

class MyDepthPipeline {
  static task = "depth-estimation";
  static model = "Xenova/depth-anything-small-hf";
  static instance = null;

  static async getInstance(progress_callback = null) {
    this.instance ??= pipeline(this.task, this.model, { progress_callback });
    return this.instance;
  }
}

// const depth_estimator = await pipeline(
//   "depth-estimation",
//   "Xenova/depth-anything-small-hf"
// );

const depth_estimator = await MyDepthPipeline.getInstance();
status.textContent = "Ready";

example.addEventListener("click", (e) => {
  e.preventDefault();
  predict(EXAMPLE_URL);
});

fileUpload.addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();

  // Set up a callback when the file is loaded
  reader.onload = (e2) => predict(e2.target.result);

  reader.readAsDataURL(file);
});

let onSliderChange;

function resizeImage(url, maxWidth = 512, maxHeight = 512) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      let width = img.width;
      let height = img.height;

      if (width > maxWidth || height > maxHeight) {
        const aspectRatio = width / height;
        if (width > height) {
          width = maxWidth;
          height = width / aspectRatio;
        } else {
          height = maxHeight;
          width = height * aspectRatio;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      resolve(canvas.toDataURL());
    };
  });
}

function convertOffscreenToCanvas(offscreen) {
  if (offscreen instanceof OffscreenCanvas) {
    const regularCanvas = document.createElement("canvas");
    regularCanvas.width = offscreen.width;
    regularCanvas.height = offscreen.height;

    const ctx = regularCanvas.getContext("2d");
    ctx.drawImage(offscreen, 0, 0);

    return regularCanvas;
  }
  return offscreen; // Already a regular canvas
}
// Predict depth map for the given image
async function predict(url) {
  imageContainer.innerHTML = "";
  const resizedImage = await resizeImage(url, 512, 512);
  const image = await RawImage.fromURL(resizedImage);

  // Set up scene and slider controls
  const { canvas, setDisplacementMap } = setupScene(
    url,
    image.width,
    image.height
  );

  imageContainer.append(canvas);

  status.textContent = "Analysing...";
  const { depth } = await depth_estimator(image);
  console.log(depth);
  setDisplacementMap(depth.toCanvas());
  status.textContent = "";

  const depthCanvasOff = depth.toCanvas();
  const depthCanvas = convertOffscreenToCanvas(depthCanvasOff);
  const aspectRatio = depthCanvas.width / depthCanvas.height;

  // Create a new canvas for depth map
  const displayedDepthCanvas = document.createElement("canvas");
  displayedDepthCanvas.width = 640; // Fixed width
  displayedDepthCanvas.height = displayedDepthCanvas.width / aspectRatio;

  // Draw the depth map on the new canvas
  const context = displayedDepthCanvas.getContext("2d");
  context.drawImage(
    depthCanvas,
    0,
    0,
    displayedDepthCanvas.width,
    displayedDepthCanvas.height
  );

  // Append the depth map canvas
  depthContainer.appendChild(displayedDepthCanvas);
  // depthContainer.append(depthCanvas);

  // Add slider control
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = 0;
  slider.max = 1;
  slider.step = 0.01;
  slider.addEventListener("input", (e) => {
    onSliderChange(parseFloat(e.target.value));
  });
  slider.defaultValue = DEFAULT_SCALE;
  imageContainer.append(slider);
}

function setupScene(url, w, h) {
  // Create new scene
  const canvas = document.createElement("canvas");
  const width = (canvas.width = imageContainer.offsetWidth);
  const height = (canvas.height = imageContainer.offsetHeight);

  const scene = new THREE.Scene();

  // Create camera and add it to the scene
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.01, 10);
  camera.position.z = 2;
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);

  // Add ambient light
  const light = new THREE.AmbientLight(0xffffff, 2);
  scene.add(light);

  // Load depth texture
  const image = new THREE.TextureLoader().load(url);
  image.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({
    map: image,
    side: THREE.DoubleSide,
  });
  material.displacementScale = DEFAULT_SCALE;

  const setDisplacementMap = (canvas) => {
    material.displacementMap = new THREE.CanvasTexture(canvas);
    material.needsUpdate = true;
  };

  const setDisplacementScale = (scale) => {
    material.displacementScale = scale;
    material.needsUpdate = true;
  };
  onSliderChange = setDisplacementScale;

  // Create plane and rescale it so that max(w, h) = 1
  const [pw, ph] = w > h ? [1, h / w] : [w / h, 1];
  const geometry = new THREE.PlaneGeometry(pw, ph, w, h);
  const plane = new THREE.Mesh(geometry, material);
  scene.add(plane);

  // Add orbit controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
    controls.update();
  });

  window.addEventListener(
    "resize",
    () => {
      const width = imageContainer.offsetWidth;
      const height = imageContainer.offsetHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height);
    },
    false
  );

  return {
    canvas: renderer.domElement,
    setDisplacementMap,
  };
}
