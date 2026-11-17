// 单一 three 实例；VRM 插件与 GLTFLoader 必须来自同一个打包图。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
window.THREE = THREE;
window.GLTFLoader = GLTFLoader;
window.VRMLoaderPlugin = VRMLoaderPlugin;
window.VRMUtils = VRMUtils;
