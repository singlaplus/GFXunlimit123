/**
 * Processor Factory
 * Routes assets to appropriate processors based on file type
 */

const path = require('path');
const AiProcessor = require('./ai-processor');
const EpsProcessor = require('./eps-processor');
const PsdProcessor = require('./psd-processor');

class ProcessorFactory {
  constructor() {
    this.processors = {
      ai: new AiProcessor(),
      eps: new EpsProcessor(),
      psd: new PsdProcessor(),
    };
  }

  /**
   * Get appropriate processor for file
   */
  getProcessor(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.ai':
        return this.processors.ai;
      case '.eps':
        return this.processors.eps;
      case '.psd':
      case '.psb':
        return this.processors.psd;
      default:
        return null;
    }
  }

  /**
   * Check if file type is supported
   */
  isSupported(filePath) {
    return this.getProcessor(filePath) !== null;
  }

  /**
   * Get supported extensions
   */
  getSupportedExtensions() {
    return Object.values(this.processors).reduce((acc, processor) => {
      return [...acc, ...processor.supportedExtensions];
    }, []);
  }

  /**
   * Process file and generate thumbnail
   */
  async process(filePath, assetId, processingJobId, options = {}) {
    const processor = this.getProcessor(filePath);

    if (!processor) {
      throw new Error(`No processor available for file: ${filePath}`);
    }

    return await processor.process(filePath, assetId, processingJobId, options);
  }

  /**
   * Get all processors
   */
  getAllProcessors() {
    return this.processors;
  }

  /**
   * Get processor by name
   */
  getProcessorByName(name) {
    return this.processors[name.toLowerCase()] || null;
  }
}

module.exports = new ProcessorFactory();
