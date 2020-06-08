/// <reference types="node" />
import { EventEmitter } from 'events';
import { BuildScript } from '../config';
export declare function paint(bus: EventEmitter, registeredWorkers: BuildScript[], buildMode: {
    dest: string;
} | undefined, devMode: {
    port: number;
    ips: string[];
    startTimeMs: number;
    addPackage: (pkgName: string) => void;
} | undefined): void;
