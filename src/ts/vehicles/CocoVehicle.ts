import * as CANNON from 'cannon';
import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { KeyBinding } from '../core/KeyBinding';
import * as THREE from 'three';
import * as Utils from '../core/FunctionLibrary';
import { SpringSimulator } from '../physics/spring_simulation/SpringSimulator';
import { World } from '../world/World';
import { EntityType } from '../enums/EntityType';

export class CocoVehicle extends Vehicle implements IControllable
{
	public entityType: EntityType = EntityType.Car; // Use Car entity type for now
	public drive: string = 'awd';
	get speed(): number {
		return this._speed;
	}
	private _speed: number = 0;

	private steeringWheel: THREE.Object3D;
	private airSpinTimer: number = 0;

	private steeringSimulator: SpringSimulator;
	private gear: number = 1;

	// Transmission
	private shiftTimer: number;
	private timeToShift: number = 0.2;

	private canTiltForwards: boolean = false;

	constructor(gltf: any)
	{
		super(gltf, {
			radius: 0.10,
			suspensionStiffness: 20,
			suspensionRestLength: 0.20,
			maxSuspensionTravel: 1,
			frictionSlip: 0.8,
			dampingRelaxation: 2,
			dampingCompression: 2,
			rollInfluence: 0.8
		});

		// Adjust physics to prevent excessive bouncing and spinning
		this.collision.material.restitution = 0; // No bounciness
		this.collision.material.friction = 0.3; // Increase friction from 0.01 to reduce sliding
		this.collision.linearDamping = 0.05; // Less resistance = better speed
		this.collision.angularDamping = 0.4; // Dampen rotation for stability

		// Ensure mass properties are updated after all shapes are added
		// This recalculates center of mass from collision shapes
		if (this.collision.shapes.length > 0)
		{
			this.collision.updateMassProperties();
		}

		this.collision.preStep = (body: CANNON.Body) => { this.physicsPreStep(body, this); };

		this.actions = {
			'throttle': new KeyBinding('KeyW'),
			'reverse': new KeyBinding('KeyS'),
			'brake': new KeyBinding('Space'),
			'left': new KeyBinding('KeyA'),
			'right': new KeyBinding('KeyD'),
			'view': new KeyBinding('KeyV'),
		};

		this.steeringSimulator = new SpringSimulator(60, 10, 0.6);
	}

	public noDirectionPressed(): boolean
	{
		let result = 
		!this.actions.throttle.isPressed &&
		!this.actions.reverse.isPressed &&
		!this.actions.left.isPressed &&
		!this.actions.right.isPressed;

		return result;
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		const tiresHaveContact = this.rayCastVehicle.numWheelsOnGround > 0;

		// Air spin
		if (!tiresHaveContact)
		{
			this.airSpinTimer += timeStep;
			if (!this.actions.throttle.isPressed) this.canTiltForwards = true;
		}
		else
		{
			this.canTiltForwards = false;
			this.airSpinTimer = 0;
		}

		// Engine
		const engineForce = 400;
		const maxGears = 5;
		const gearsMaxSpeeds = {
			'R': -4,
			'0': 0,
			'1': 5,
			'2': 9,
			'3': 13,
			'4': 17,
			'5': 22,
		};

		if (this.shiftTimer > 0)
		{
			this.shiftTimer -= timeStep;
			if (this.shiftTimer < 0) this.shiftTimer = 0;
		}
		else
		{
			// Transmission 
			if (this.actions.reverse.isPressed)
			{
				const powerFactor = (gearsMaxSpeeds['R'] - this.speed) / Math.abs(gearsMaxSpeeds['R']);
				const force = (engineForce / this.gear) * (Math.abs(powerFactor) ** 1);

				this.applyEngineForce(force);
			}
			else
			{
				const powerFactor = (gearsMaxSpeeds[this.gear] - this.speed) / (gearsMaxSpeeds[this.gear] - gearsMaxSpeeds[this.gear - 1]);

				if (powerFactor < 0.1 && this.gear < maxGears) this.shiftUp();
				else if (this.gear > 1 && powerFactor > 1.2) this.shiftDown();
				else if (this.actions.throttle.isPressed)
				{
					const force = (engineForce / this.gear) * (powerFactor ** 1);
					this.applyEngineForce(-force);
				}
			}
		}

		// Steering
		this.steeringSimulator.simulate(timeStep);
		this.setSteeringValue(this.steeringSimulator.position);
		if (this.steeringWheel !== undefined) this.steeringWheel.rotation.z = -this.steeringSimulator.position * 2;

		// Upright stabilization when on ground - only when significantly tilted and slow/stationary
		if (tiresHaveContact && Math.abs(this.collision.velocity.length()) < 2.0)
		{
			const quat = Utils.threeQuat(this.collision.quaternion);
			const up = Utils.getUp(this);
			const worldUp = new THREE.Vector3(0, 1, 0);
			
			// Calculate how much we're tilted
			const tiltAmount = 1 - up.dot(worldUp);
			
			// Only correct if significantly tilted
			if (tiltAmount > 0.05)
			{
				// Weaker correction when moving, stronger when stationary
				const speedFactor = Math.max(0.3, 1.0 - Math.abs(this.collision.velocity.length()) * 0.2);
				const correctionStrength = Math.min(tiltAmount * 5 * speedFactor, 2.0);
				const correctionAxis = new THREE.Vector3().crossVectors(up, worldUp);
				
				if (correctionAxis.length() > 0.001)
				{
					correctionAxis.normalize();
					const correctionAngle = Math.acos(THREE.MathUtils.clamp(up.dot(worldUp), -1, 1));
					
					if (correctionAngle > 0.001)
					{
						const correctionVec = Utils.cannonVector(correctionAxis.multiplyScalar(correctionAngle * correctionStrength * 8));
						this.collision.angularVelocity.vadd(correctionVec, this.collision.angularVelocity);
					}
				}
			}
		}

		if (this.rayCastVehicle.numWheelsOnGround < 3 && Math.abs(this.collision.velocity.length()) < 0.5)	
		{	
			this.collision.quaternion.copy(this.collision.initQuaternion);	
		}

		// Braking
		if (this.actions.brake.isPressed)
		{
			this.setBrake(0.35, 'rwd');
		}
		else
		{
			this.setBrake(0, 'all');
		}

		// Update speed
		const velocity = new CANNON.Vec3().copy(this.collision.velocity);
		const forward = Utils.getForward(this);
		const forwardVelocity = velocity.dot(Utils.cannonVector(forward));
		this._speed = forwardVelocity;
	}

	public physicsPreStep(body: CANNON.Body, coco: CocoVehicle): void
	{
		// Same physics as Car
		const quat = Utils.threeQuat(body.quaternion);
		const forward = Utils.getForward(this);
		const right = Utils.getRight(this);
		const up = Utils.getUp(this);

		const spinVectorForward = Utils.cannonVector(forward);
		const spinVectorRight = Utils.cannonVector(right);
		const effectiveSpinVectorForward = new CANNON.Vec3().copy(spinVectorForward);
		effectiveSpinVectorForward.scale(0.3);
		const effectiveSpinVectorRight = new CANNON.Vec3().copy(spinVectorRight);
		effectiveSpinVectorRight.scale(0.3);

		const maxAirSpinMagnitude = 2;

		let angVel = body.angularVelocity;

		// Right
		if (this.canTiltForwards && this.actions.reverse.isPressed && !this.actions.throttle.isPressed) {
			if (angVel.dot(effectiveSpinVectorForward) < maxAirSpinMagnitude) {
				angVel.vadd(effectiveSpinVectorForward, angVel);
			}
		} else {
			angVel.vsub(effectiveSpinVectorForward, angVel);
		}

		// Forwards
		if (this.canTiltForwards && this.actions.throttle.isPressed && !this.actions.reverse.isPressed) {
			if (angVel.dot(spinVectorRight) < maxAirSpinMagnitude) {
				angVel.vadd(effectiveSpinVectorRight, angVel);
			}
		} else
		// Backwards
		if (this.actions.reverse.isPressed && !this.actions.throttle.isPressed) {
			if (angVel.dot(spinVectorRight) > -maxAirSpinMagnitude) {
				angVel.vsub(effectiveSpinVectorRight, angVel);
			}
		}

		// Active stabilization: reduce unwanted spinning when on ground
		const tiresHaveContact = this.rayCastVehicle.numWheelsOnGround > 0;
		if (tiresHaveContact)
		{
			// Only dampen unwanted rotation when not steering
			if (!this.actions.left.isPressed && !this.actions.right.isPressed)
			{
				angVel.x *= 0.85;
				angVel.y *= 0.85;
				angVel.z *= 0.85;
			}
			
			// Only apply upright correction when significantly tilted and slow
			const speed = this.collision.velocity.length();
			if (speed < 1.5)
			{
				const up = Utils.getUp(this);
				const worldUp = new THREE.Vector3(0, 1, 0);
				const tiltAmount = 1 - up.dot(worldUp);
				
				// Only correct significant tilts
				if (tiltAmount > 0.05)
				{
					const correctionAxis = new THREE.Vector3().crossVectors(up, worldUp);
					if (correctionAxis.length() > 0.001)
					{
						correctionAxis.normalize();
						const correctionAngle = Math.acos(THREE.MathUtils.clamp(up.dot(worldUp), -1, 1));
						const correctionVec = Utils.cannonVector(correctionAxis.multiplyScalar(correctionAngle * tiltAmount * 6));
						angVel.vadd(correctionVec, angVel);
					}
				}
			}
		}

		// Steering
		const velocity = new CANNON.Vec3().copy(this.collision.velocity);
		velocity.normalize();
		let driftCorrection = Utils.getSignedAngleBetweenVectors(Utils.threeVector(velocity), forward);

		const maxSteerVal = 0.8;
		let speedFactor = THREE.MathUtils.clamp(this.speed * 0.3, 1, Number.MAX_VALUE);

		if (this.actions.right.isPressed)
		{
			let steering = Math.min(-maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = THREE.MathUtils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else if (this.actions.left.isPressed)
		{
			let steering = Math.max(maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = THREE.MathUtils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else this.steeringSimulator.target = 0;
	}

	private shiftUp(): void
	{
		if (this.gear < 5)
		{
			this.gear++;
			this.shiftTimer = this.timeToShift;
		}
	}

	private shiftDown(): void
	{
		if (this.gear > 1)
		{
			this.gear--;
			this.shiftTimer = this.timeToShift;
		}
	}

	public onInputChange(): void
	{
		if (this.actions.view.justPressed)
		{
			this.toggleFirstPersonView();
		}
	}

	public inputReceiverInit(): void
	{
		super.inputReceiverInit();

		this.world.updateControls([
			{
				keys: ['W', 'S'],
				desc: 'Accelerate, Brake / Reverse'
			},
			{
				keys: ['A', 'D'],
				desc: 'Steering'
			},
			{
				keys: ['Space'],
				desc: 'Handbrake'
			},
			{
				keys: ['V'],
				desc: 'View select'
			},
			{
				keys: ['Shift', '+', 'R'],
				desc: 'Respawn'
			},
			{
				keys: ['Shift', '+', 'C'],
				desc: 'Free camera'
			},
		]);
	}

	// No override needed - parent class readVehicleData() will read all data from Blender GLTF
	// (wheels, seats, collision, camera, etc. are all read automatically)
}
