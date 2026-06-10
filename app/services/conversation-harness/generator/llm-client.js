class MockLLMClient {
  async generate(prompt) {
    return String(prompt || '').slice(0, 600);
  }

  async classify() {
    return null;
  }
}

module.exports = {
  MockLLMClient
};
