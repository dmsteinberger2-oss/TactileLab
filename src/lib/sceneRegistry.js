// Lets non-React code (the kit exporter) reach the live three.js scene.
let root = null
export const registerSceneRoot = (scene) => { root = scene }
export const getSceneRoot = () => root
