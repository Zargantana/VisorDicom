import { DCMTagBase } from "./DCM-tag-base.class";

export abstract class UIDCMTag extends DCMTagBase {
    public abstract getName(TagHigh: number, TagLow: number): string | undefined;
}