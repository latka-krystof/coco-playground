import { CharacterStateBase } from './_stateLibrary';
import { Character } from '../Character';
import * as THREE from 'three';
import * as Utils from '../../core/FunctionLibrary';

export class VehicleLikeMovement extends CharacterStateBase
{
	private speed: number = 0;
	private maxSpeed: number = 8;
	private acceleration: number = 15;
	private deceleration: number = 20;
	private turnSpeed: number = 3;

	constructor(character: Character)
	{
		super(character);

		// Use arcade velocity for smooth vehicle-like movement
		this.character.arcadeVelocityIsAdditive = false;
		this.character.setArcadeVelocityInfluence(1, 0, 1);
		
		// Disable vehicle entry/exit for COCO
		this.canEnterVehicles = false;
		this.canFindVehiclesToEnter = false;
		
		// Play idle animation (or walking if COCO has one)
		this.playAnimation('idle', 0.1);
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		// Handle throttle/reverse (W/S keys)
		if (this.character.actions.up.isPressed) // W = throttle
		{
			this.speed = Math.min(this.speed + this.acceleration * timeStep, this.maxSpeed);
		}
		else if (this.character.actions.down.isPressed) // S = reverse
		{
			this.speed = Math.max(this.speed - this.acceleration * timeStep, -this.maxSpeed * 0.5);
		}
		else
		{
			// Decelerate when no input - force to 0 quickly
			if (this.speed > 0)
			{
				this.speed = Math.max(0, this.speed - this.deceleration * timeStep);
			}
			else if (this.speed < 0)
			{
				this.speed = Math.min(0, this.speed + this.deceleration * timeStep);
			}
			
			// Force speed to exactly 0 when no throttle to prevent drift
			if (Math.abs(this.speed) < 0.01)
			{
				this.speed = 0;
			}
		}

		// Handle steering (A/D keys) - ONLY when throttle is applied (like a real car)
		// Steering without throttle should not cause movement
		const hasThrottle = this.character.actions.up.isPressed || this.character.actions.down.isPressed;
		
		if (hasThrottle)
		{
			// Only allow steering when moving (throttle applied)
			if (this.character.actions.left.isPressed) // A = turn left
			{
				this.character.angularVelocity = -this.turnSpeed;
			}
			else if (this.character.actions.right.isPressed) // D = turn right
			{
				this.character.angularVelocity = this.turnSpeed;
			}
			else
			{
				this.character.angularVelocity = 0;
			}
		}
		else
		{
			// No steering when no throttle - prevents turning in place
			this.character.angularVelocity = 0;
		}

		// Apply rotation based on steering input (only when throttle is applied)
		if (this.character.angularVelocity !== 0 && hasThrottle)
		{
			const rotationAmount = this.character.angularVelocity * timeStep;
			const rotationAxis = new THREE.Vector3(0, 1, 0);
			this.character.orientation.applyAxisAngle(rotationAxis, rotationAmount);
			this.character.orientationTarget.copy(this.character.orientation);
		}

		// Set velocity based on speed - movement is in the direction COCO is facing (not camera-relative)
		// setArcadeVelocityTarget uses local space: z = forward, x = right, y = up
		// Only move if speed is significant (prevents drift from tiny values)
		if (Math.abs(this.speed) > 0.01)
		{
			this.character.setArcadeVelocityTarget(this.speed, 0, 0);
		}
		else
		{
			// Force stop when no throttle
			this.character.setArcadeVelocityTarget(0, 0, 0);
			this.speed = 0; // Ensure speed is exactly 0
		}

		// DO NOT call setCameraRelativeOrientationTarget() - we want movement in COCO's facing direction
		// The orientation is already set by steering above, so we just need to keep it synced
		this.character.orientationTarget.copy(this.character.orientation);
	}

	public onInputChange(): void
	{
		// Override to prevent all state transitions
		// Don't call super.onInputChange() to avoid vehicle entry/exit logic
		
		// Prevent jumping
		if (this.character.actions.jump.justPressed)
		{
			// Ignore jump input - COCO doesn't jump
			this.character.actions.jump.isPressed = false;
			this.character.actions.jump.justPressed = false;
		}
		
		// Prevent any state transitions - COCO stays in vehicle-like movement mode
		// No transitions to Walk, Sprint, JumpIdle, Falling, etc.
	}

	public fallInAir(): void
	{
		// Override to prevent transitioning to Falling state
		// COCO should stay in vehicle-like movement even when in air
		// The physics will handle falling, but we don't want state changes
	}
}
