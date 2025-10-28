class NodeEngine {
    constructor(canvas_id, viewport) {
        this.viewport = viewport;
        this.graph = new LGraph();
        this.canvas = new LGraphCanvas(canvas_id, this.graph);
        this.registerCoreNodes(this);
        this.setupGraph();

        this.graph.start();
    }

    registerCoreNodes(engine) {
        function ViewerNode() {
            this.addInput("mesh", "mesh");
        }

        ViewerNode.title = "Viewer";

        ViewerNode.prototype.onExecute = function() {
            const mesh = this.getInputData(0);
            if (mesh) {
                engine.viewport.clearScene();
                engine.viewport.addMesh(mesh);
            }
        }

        LiteGraph.registerNodeType("output/viewer", ViewerNode);

        function MyAddNode() {
            this.addInput("A", "number");
            this.addInput("B", "number");
            this.addOutput("A+B", "number");
            this.properties = { precision: 1 };
        }

        MyAddNode.title = "Sum";

        MyAddNode.prototype.onExecute = function() {
            var A = this.getInputData(0);
            if (A === undefined) A = 0;
            var B = this.getInputData(1);
            if (B === undefined) B = 0;
            this.setOutputData(0, A + B);
        }

        LiteGraph.registerNodeType("basic/sum", MyAddNode);

        function CubeNode() {
            this.addInput("width", "number");
            this.addInput("height", "number");
            this.addInput("depth", "number");
            this.addOutput("mesh", "mesh");
            this.properties = { width: 1, height: 1, depth: 1 };
        }

        CubeNode.title = "Cube";

        CubeNode.prototype.onExecute = function() {
            const width = this.getInputData(0) !== undefined ? this.getInputData(0) : this.properties.width;
            const height = this.getInputData(1) !== undefined ? this.getInputData(1) : this.properties.height;
            const depth = this.getInputData(2) !== undefined ? this.getInputData(2) : this.properties.depth;
            const geometry = new THREE.BoxGeometry(width, height, depth);
            const material = new THREE.MeshNormalMaterial();
            const mesh = new THREE.Mesh(geometry, material);
            this.setOutputData(0, mesh);
        }

        LiteGraph.registerNodeType("geometry/cube", CubeNode);

        function PlaneNode() {
            this.addInput("width", "number");
            this.addInput("height", "number");
            this.addOutput("mesh", "mesh");
            this.properties = { width: 1, height: 1 };
        }

        PlaneNode.title = "Plane";

        PlaneNode.prototype.onExecute = function() {
            const width = this.getInputData(0) !== undefined ? this.getInputData(0) : this.properties.width;
            const height = this.getInputData(1) !== undefined ? this.getInputData(1) : this.properties.height;
            const geometry = new THREE.PlaneGeometry(width, height);
            const material = new THREE.MeshNormalMaterial();
            const mesh = new THREE.Mesh(geometry, material);
            this.setOutputData(0, mesh);
        }

        LiteGraph.registerNodeType("geometry/plane", PlaneNode);

        function CylinderNode() {
            this.addInput("radiusTop", "number");
            this.addInput("radiusBottom", "number");
            this.addInput("height", "number");
            this.addInput("radialSegments", "number");
            this.addOutput("mesh", "mesh");
            this.properties = { radiusTop: 1, radiusBottom: 1, height: 2, radialSegments: 8 };
        }

        CylinderNode.title = "Cylinder";

        CylinderNode.prototype.onExecute = function() {
            const radiusTop = this.getInputData(0) !== undefined ? this.getInputData(0) : this.properties.radiusTop;
            const radiusBottom = this.getInputData(1) !== undefined ? this.getInputData(1) : this.properties.radiusBottom;
            const height = this.getInputData(2) !== undefined ? this.getInputData(2) : this.properties.height;
            const radialSegments = this.getInputData(3) !== undefined ? this.getInputData(3) : this.properties.radialSegments;
            const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
            const material = new THREE.MeshNormalMaterial();
            const mesh = new THREE.Mesh(geometry, material);
            this.setOutputData(0, mesh);
        }

        LiteGraph.registerNodeType("geometry/cylinder", CylinderNode);

        function MoveNode() {
            this.addInput("mesh", "mesh");
            this.addInput("translation", "vec3");
            this.addOutput("mesh", "mesh");
            this.properties = { translation: [0, 0, 0] };
        }

        MoveNode.title = "Move";

        MoveNode.prototype.onExecute = function() {
            const mesh = this.getInputData(0);
            if (mesh) {
                const newMesh = mesh.clone();
                const translation = this.getInputData(1) || this.properties.translation;
                newMesh.position.set(translation[0], translation[1], translation[2]);
                this.setOutputData(0, newMesh);
            }
        }

        LiteGraph.registerNodeType("transform/move", MoveNode);

        function RotateNode() {
            this.addInput("mesh", "mesh");
            this.addInput("rotation", "vec3");
            this.addOutput("mesh", "mesh");
            this.properties = { rotation: [0, 0, 0] };
        }

        RotateNode.title = "Rotate";

        RotateNode.prototype.onExecute = function() {
            const mesh = this.getInputData(0);
            if (mesh) {
                const newMesh = mesh.clone();
                const rotation = this.getInputData(1) || this.properties.rotation;
                newMesh.rotation.set(
                    THREE.MathUtils.degToRad(rotation[0]),
                    THREE.MathUtils.degToRad(rotation[1]),
                    THREE.MathUtils.degToRad(rotation[2])
                );
                this.setOutputData(0, newMesh);
            }
        }

        LiteGraph.registerNodeType("transform/rotate", RotateNode);

        function ScaleNode() {
            this.addInput("mesh", "mesh");
            this.addInput("scale", "vec3");
            this.addOutput("mesh", "mesh");
            this.properties = { scale: [1, 1, 1] };
        }

        ScaleNode.title = "Scale";

        ScaleNode.prototype.onExecute = function() {
            const mesh = this.getInputData(0);
            if (mesh) {
                const newMesh = mesh.clone();
                const scale = this.getInputData(1) || this.properties.scale;
                newMesh.scale.set(scale[0], scale[1], scale[2]);
                this.setOutputData(0, newMesh);
            }
        }

        LiteGraph.registerNodeType("transform/scale", ScaleNode);

        function ColorNode() {
            this.addInput("mesh", "mesh");
            this.addInput("color", "color");
            this.addOutput("mesh", "mesh");
            this.properties = { color: "#ffffff" };
        }

        ColorNode.title = "Color";

        ColorNode.prototype.onExecute = function() {
            const mesh = this.getInputData(0);
            if (mesh) {
                const newMesh = mesh.clone();
                const color = this.getInputData(1) || this.properties.color;
                newMesh.material = new THREE.MeshBasicMaterial({ color: color });
                this.setOutputData(0, newMesh);
            }
        }

        LiteGraph.registerNodeType("material/color", ColorNode);
    }

    setupGraph() {
        var node_sum = LiteGraph.createNode("basic/sum");
        node_sum.pos = [200, 200];
        this.graph.add(node_sum);

        var node_cube = LiteGraph.createNode("geometry/cube");
        node_cube.pos = [400, 200];
        this.graph.add(node_cube);

        var node_viewer = LiteGraph.createNode("output/viewer");
        node_viewer.pos = [600, 200];
        this.graph.add(node_viewer);

        node_cube.connect(0, node_viewer, 0);
    }

    evaluateGraph() {
        this.graph.runStep(1);
    }
}
