class Viewport {
    constructor(container_id) {
        this.container = document.getElementById(container_id);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, this.container.offsetWidth / this.container.offsetHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
        this.container.appendChild(this.renderer.domElement);

        this.camera.position.z = 5;

        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        this.scene.add(directionalLight);

        this.animate();
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.renderer.render(this.scene, this.camera);
    }

    addMesh(mesh) {
        this.scene.add(mesh);
    }

    clearScene() {
        while(this.scene.children.length > 0){
            this.scene.remove(this.scene.children[0]);
        }
    }
}
