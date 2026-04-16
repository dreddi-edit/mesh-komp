'use strict';

// Vanilla JS schema validator to avoid Zod dependency issues

const assistantRunSchema = {
  validate: (data) => {
    if (!data || typeof data !== 'object') {
      return { success: false, error: 'Request body must be an object' };
    }
    if (!data.prompt || typeof data.prompt !== 'string') {
      return { success: false, error: 'Prompt is required and must be a string' };
    }
    
    return {
      success: true,
      data: {
        model: data.model || 'claude-sonnet-4-6',
        mode: data.mode,
        autonomyMode: data.autonomyMode,
        prompt: data.prompt,
        workspaceFolderName: data.workspaceFolderName,
        activeFilePath: data.activeFilePath,
        selectedPaths: Array.isArray(data.selectedPaths) ? data.selectedPaths : [],
        terminalSessionId: data.terminalSessionId,
        opsSelection: data.opsSelection && typeof data.opsSelection === 'object' && !Array.isArray(data.opsSelection) ? data.opsSelection : {},
        chatSessionId: data.chatSessionId
      }
    };
  }
};

const terminalSessionSchema = {
  validate: (data) => {
    if (!data || typeof data !== 'object') {
      return { success: false, error: 'Request body must be an object' };
    }
    return {
      success: true,
      data: {
        shell: data.shell
      }
    };
  }
};

const terminalInputSchema = {
  validate: (data) => {
    if (!data || typeof data !== 'object') {
      return { success: false, error: 'Request body must be an object' };
    }
    if (typeof data.input !== 'string') {
      return { success: false, error: 'Input is required and must be a string' };
    }
    
    return {
      success: true,
      data: {
        input: data.input
      }
    };
  }
};

module.exports = {
  assistantRunSchema,
  terminalSessionSchema,
  terminalInputSchema,
};
