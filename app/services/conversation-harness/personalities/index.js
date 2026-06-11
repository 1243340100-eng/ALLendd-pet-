const warmFriend = require('./warm-friend');
const calmExpert = require('./calm-expert');
const playfulCompanion = require('./playful-companion');
const roxyLittleTeacher = require('./roxy-little-teacher');

const profiles = {
  [warmFriend.id]: warmFriend,
  [calmExpert.id]: calmExpert,
  [playfulCompanion.id]: playfulCompanion,
  [roxyLittleTeacher.id]: roxyLittleTeacher
};

function getPersonalityProfile(id = 'warm_friend') {
  return profiles[id] || warmFriend;
}

module.exports = {
  warmFriend,
  calmExpert,
  playfulCompanion,
  roxyLittleTeacher,
  profiles,
  getPersonalityProfile
};
