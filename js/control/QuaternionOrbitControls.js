import { Vector2, Vector3, Quaternion } from 'three';

export class QuaternionOrbitControls {
	constructor(camera, domElement, target = new Vector3()) {
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

		this.movePrev.copy(this._getMouseOnCircle(event.clientX, event.clientY));

		if (event.shiftKey) {
			this._state = 'pan';
		} else {
			this._state = 'orbit';
		}

		const onMouseMove = (event) => {
			this.moveCurr.copy(this._getMouseOnCircle(event.clientX, event.clientY));

			if (this._state === 'orbit') {
				this._rotateCamera();
			} else if (this._state === 'pan') {
				this._panCamera();
			}

			this.movePrev.copy(this.moveCurr);
		};

		const onMouseUp = () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
			this._state = null;
		};

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	}

	_onMouseWheel(event) {
		if (!this.enabled) return;
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
}