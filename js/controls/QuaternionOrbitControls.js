import { Vector2, Vector3, Quaternion, Box3, Sphere } from 'three';

export class QuaternionOrbitControls {
	constructor(editor, camera, domElement, target = new Vector3()) {
		this.editor = editor;
		this.keyHandler = editor.keyHandler;
		this.camera = camera;
		this.domElement = domElement;
		this.target = target;
		this.enabled = true;

		this.moveCurr = new Vector2();
		this.movePrev = new Vector2();

		this.rotateSpeed = 3.5;
		this.zoomSpeed = 2.0;
		this.panSpeed = 0.8;

		this.eye = new Vector3();

		this._state = null;

		this._bindEvents();
	}

	_bindEvents() {
		this.domElement.addEventListener('mousedown', this._onMouseDown.bind(this));
		this.domElement.addEventListener('wheel', this._onMouseWheel.bind(this));
	}

	_getMouseOnCircle(x, y) {
		const rect = this.domElement.getBoundingClientRect();
		return new Vector2(
			((x - rect.left) / rect.width) * 2 - 1,
			-((y - rect.top) / rect.height) * 2 + 1
		);
	}

	_onMouseDown(event) {
		if (!this.enabled || event.button !== 1) return;
		if (!this.keyHandler.startInteraction('orbit')) return;

		const type = event.shiftKey ? 'pan' : 'orbit';
		this._state = type;
		this.movePrev.copy(this._getMouseOnCircle(event.clientX, event.clientY));
		this._startButton = event.button;

		const onMouseMove = (event) => {
			this.moveCurr.copy(this._getMouseOnCircle(event.clientX, event.clientY));

			if (this._state === 'orbit') {
				this._rotateCamera();
			} else if (this._state === 'pan') {
				this._panCamera();
			}

			this.movePrev.copy(this.moveCurr);
		};

		const onMouseUp = (event) => {
			if (event.button !== this._startButton) return;
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
			this._state = null;

			this.keyHandler.endInteraction('orbit');
		};

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	}

	_onMouseWheel(event) {
		if (!this.enabled) return;

		if (this.keyHandler.activeInteraction) return;

		if (event.deltaY === 0) {
			event.preventDefault();
			return;
		}

		event.preventDefault();
		this._zoom(event);
	}

	_zoom(event) {
		const delta = event.deltaY > 0 ? 1 : -1;

		this.eye.subVectors(this.camera.position, this.target);

		const zoomFactor = 1 + delta * 0.1 * this.zoomSpeed;

		this.eye.multiplyScalar(zoomFactor);
		this.camera.position.copy(this.target).add(this.eye);
		this.camera.lookAt(this.target);
	}

	_panCamera() {
		const moveDelta = new Vector2().subVectors(this.moveCurr, this.movePrev);
		if (moveDelta.lengthSq() === 0) return;
		
		this.eye.subVectors(this.camera.position, this.target);
		const eyeLength = this.eye.length();

		const eyeDirection = this.eye.clone().normalize();
		const cameraUp = this.camera.up.clone().normalize();
		const right = new Vector3().crossVectors(cameraUp, eyeDirection).normalize();

		const panX = -moveDelta.x * eyeLength * this.panSpeed;
		const panY = -moveDelta.y * eyeLength * this.panSpeed;

		const panOffset = new Vector3().addScaledVector(right, panX).addScaledVector(cameraUp, panY);

		this.camera.position.add(panOffset);
		this.target.add(panOffset);
		this.camera.lookAt(this.target);
	}

	_rotateCamera() {
		this.eye.subVectors(this.camera.position, this.target);

		const moveDelta = new Vector2().subVectors(this.moveCurr, this.movePrev);
		if (moveDelta.lengthSq() === 0) return;

    const angleYaw = -moveDelta.x * this.rotateSpeed;
    const anglePitch = moveDelta.y * this.rotateSpeed;

		const eyeDirection = this.eye.clone().normalize();
		const upDirection = this.camera.up.clone().normalize();
    const worldYAxis = new Vector3(0, 1, 0);
		const worldUp = worldYAxis.clone().multiplyScalar(upDirection.dot(worldYAxis)).normalize();

		const rightDirection = new Vector3().crossVectors(upDirection, eyeDirection).normalize();

    // Create pitch quaternion around right dicrection
    const quatPitch = new Quaternion().setFromAxisAngle(rightDirection, anglePitch);

    // Create yaw quaternion around world up
    const quatYaw = new Quaternion().setFromAxisAngle(worldUp, angleYaw);

    const combinedQuat = new Quaternion().multiplyQuaternions(quatYaw, quatPitch);

    this.eye.applyQuaternion(combinedQuat);
    this.camera.up.applyQuaternion(combinedQuat);

    this.camera.position.copy(this.target).add(this.eye);
    this.camera.lookAt(this.target);

    this.movePrev.copy(this.moveCurr);
	}

	_focus(targetObjects) {
		const box = new Box3();
		const sphere = new Sphere();

		const objects = Array.isArray(targetObjects) ? targetObjects : [targetObjects];
		if (objects.length === 0) return;
		objects.forEach(obj => {box.expandByObject(obj)});

		let distance;

		if (!box.isEmpty()) {
			box.getCenter(this.target);
			box.getBoundingSphere(sphere);
			distance = sphere.radius;
		} else {
			objects[0].getWorldPosition(this.target);
			distance = 0.5;
		}

		this.eye.set(0, 0, 1);
		this.eye.applyQuaternion(this.camera.quaternion);
		this.eye.multiplyScalar(distance * 4);

		this.camera.position.copy(this.target).add(this.eye);
		this.camera.lookAt(this.target);
	}
}