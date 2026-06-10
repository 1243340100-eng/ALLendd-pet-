const warmFriend = require('./warm-friend');
const calmExpert = require('./calm-expert');
const playfulCompanion = require('./playful-companion');

const profiles = {
  [warmFriend.id]: warmFriend,
  [calmExpert.id]: calmExpert,
  [playfulCompanion.id]: playfulCompanion
};

function getPersonalityProfile(id = 'warm_friend') {
  return profiles[id] || warmFriend;
}

module.exports = {
  warmFriend,
  calmExpert,
  playfulCompanion,
  profiles,
  getPersonalityProfile
};
