(function exposePetProfile() {
  const profile = {
    displayName: 'Pet Framework',
    characterName: 'Pet',
    spriteSheet: '',
    usePlaceholderPet: true,
    defaultLanguage: 'zh',
    defaultDrinkReminderText: '\u8be5\u559d\u6c34\u5566\uff0c\u7167\u987e\u597d\u81ea\u5df1\u54e6\u3002',
    defaultNightReminderText: '\u5f88\u665a\u5566\uff0c\u65e9\u70b9\u4f11\u606f\uff0c\u665a\u5b89\u3002',
    corePrompt: [
      '\u4f60\u662f\u4e00\u4e2a\u684c\u9762\u5ba0\u7269\u6846\u67b6\u7684\u9ed8\u8ba4\u6d4b\u8bd5\u89d2\u8272\u3002',
      '\u4f60\u7684\u8bed\u6c14\u53cb\u597d\u3001\u7b80\u77ed\u3001\u793c\u8c8c\uff0c\u9002\u5408\u663e\u793a\u5728\u684c\u5ba0\u6c14\u6ce1\u4e2d\u3002',
      '\u5f53\u5f00\u53d1\u8005\u66ff\u6362\u89d2\u8272\u914d\u7f6e\u548c\u52a8\u753b\u8d44\u4ea7\u540e\uff0c\u4f60\u5e94\u5448\u73b0\u4e3a\u65b0\u7684\u684c\u5ba0\u89d2\u8272\u3002'
    ].join('\n')
  };

  if (typeof window !== 'undefined') {
    window.petProfile = profile;
  }

  if (typeof module !== 'undefined') {
    module.exports = profile;
  }
}());
