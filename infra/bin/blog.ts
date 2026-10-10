import { resolve } from "node:path";
import { App } from "aws-cdk-lib";
import { createStacks } from "../lib/app";

const app = new App();
createStacks(app, resolve(import.meta.dirname, "../.."));
app.synth();
