import { commands } from "../utils";
import { getScripts, parseScript } from "../utils/db";

type ScriptUpdatePayload = {
  id?: number;
  code?: string;
  message?: string;
  isNew?: boolean;
  config?: DeepPartial<VMScript["config"]>;
  custom?: DeepPartial<VMScript["custom"]>;
  props?: DeepPartial<VMScript["props"]>;
  update?: Record<string, unknown>;
};

export const script = {
  /**
   * Update an existing script identified by the provided id
   * @param {{ id, code, message, isNew, config, custom, props, update }} data
   * @return {Promise<{ isNew?, update, where }>}
   */
  update: (data: ScriptUpdatePayload) => parseScript(data),
  /**
   * List all available scripts, without script code
   * @return {Promise<VMScript[]>}
   */
  list: async () => getScripts(),
  /**
   * Get script code of an existing script
   * @param {number} id
   * @return {Promise<string>}
   */
  get: commands.GetScriptCode,
  /**
   * Remove script
   * @param {number} id
   * @return {Promise<void>}
   */
  remove: (id: number) => commands.MarkRemoved({ id, removed: true }),
};
