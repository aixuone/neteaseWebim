/*
* @Author: 消息逻辑
*/

'use strict';

YX.fn.message = function() {
  this.$sendBtn = $('#sendBtn');
  this.$messageText = $('#messageText');
  this.$chooseFileBtn = $('#chooseFileBtn');
  this.$fileInput = $('#uploadFile');

  this.$sendBtn.on('click', this.sendTextMessage.bind(this));
  this.$messageText.on('keydown', this.inputMessage.bind(this));
  this.$chooseFileBtn.on('click', 'a', this.chooseFile.bind(this));
  this.$fileInput.on('change', this.uploadFile.bind(this));
  //消息重发
  this.$chatContent.delegate('.j-resend', 'click', this.doResend.bind(this));
  //语音播发
  this.$chatContent.delegate('.j-mbox', 'click', this.playAudio);
  //聊天面板右键菜单
  $.contextMenu({
    selector: '.j-msg',
    callback: function(key, options) {
      if (key === 'delete') {
        var id = options.$trigger.parent().data('id');
        var msg = this.cache.findMsg(this.crtSession, id);
        if (!msg || options.$trigger.hasClass('j-msg')) {
        }
        if (msg.flow !== 'out' && msg.scene === 'p2p') {
          alert('点对点场景，只能撤回自己发的消息');
          return;
        }
        if (
          !this.cache.isCurSessionTeamManager &&
          msg.flow !== 'out' &&
          msg.scene === 'team'
        ) {
          alert('群会话场景，非管理员不能撤回别人发的消息');
          return;
        }
        options.$trigger.removeClass('j-msg');
        this.nim.deleteMsg({
          msg: msg,
          done: function(err) {
            options.$trigger.addClass('j-msg');
            if (err) {
              if (err.code === 508) {
                alert('发送时间超过2分钟的消息，不能被撤回');
              } else {
                alert(err.message || '操作失败');
              }
            } else {
              msg.opeAccount = userUID;
              this.backoutMsg(id, { msg: msg });
            }
          }.bind(this)
        });
      }
    }.bind(this),
    items: {
      delete: { name: '撤回', icon: 'delete' }
    }
  });

  //表情贴图模块
  this.initEmoji();
};
/**
 * 处理收到的消息
 * @param  {Object} msg
 * @return
 */
YX.fn.doMsg = function(msg) {
  var that = this,
    who = msg.to === userUID ? msg.from : msg.to,
    updateContentUI = function() {
      //如果当前消息对象的会话面板打开
      if (that.crtSessionAccount === who) {
        that.sendMsgRead(who, msg.scene);
        that.cache.dealTeamMsgReceipts(msg, function () {
          var msgHtml = appUI.updateChatContentUI(msg, that.cache);
          that.$chatContent.find('.no-msg').remove();
          that.$chatContent.append(msgHtml).scrollTop(99999);
        })
      }
    };
  //非群通知消息处理
  if (/text|image|file|audio|video|geo|custom|tip|robot/i.test(msg.type)) {
    this.cache.addMsgs(msg);
    var account = msg.scene === 'p2p' ? who : msg.from;
    //用户信息本地没有缓存，需存储
    if (!this.cache.getUserById(account)) {
      this.mysdk.getUser(account, function(err, data) {
        if (!err) {
          that.cache.updatePersonlist(data);
          updateContentUI();
        }
      });
    } else {
      this.buildSessions();
      updateContentUI();
    }
  } else {
    // 群消息处理
    this.messageHandler(msg, updateContentUI);
  }
};
/*****************************************************************
 * emoji模块
 ****************************************************************/
YX.fn.initEmoji = function() {
  this.$showEmoji = $('#showEmoji');
  this.$showEmoji.on('click', this.showEmoji.bind(this));
  var that = this,
    emojiConfig = {
      emojiList: emojiList, //普通表情
      pinupList: pinupList, //贴图
      width: 500,
      height: 300,
      imgpath: './images/',
      callback: function(result) {
        that.cbShowEmoji(result);
      }
    };
  this.$emNode = new CEmojiEngine($('#emojiTag')[0], emojiConfig);
  this.$emNode._$hide();
};
/**
 * 选择表情回调
 * @param  {objcet} result 点击表情/贴图返回的数据
 */
YX.fn.cbShowEmoji = function(result) {
  if (!!result) {
    var scene = this.crtSessionType,
      to = this.crtSessionAccount;
    // 贴图，发送自定义消息体
    if (result.type === 'pinup') {
      var index = Number(result.emoji) + 1;
      var content = {
        type: 3,
        data: {
          catalog: result.category,
          chartlet: result.category + '0' + (index >= 10 ? index : '0' + index)
        }
      };
      this.mysdk.sendCustomMessage(
        scene,
        to,
        content,
        this.sendMsgDone.bind(this)
      );
    } else {
      // 表情，内容直接加到输入框
      this.$messageText[0].value = this.$messageText[0].value + result.emoji;
    }
  }
};

YX.fn.showEmoji = function() {
  this.$emNode._$show();
};
/*************************************************************************
 * 发送消息逻辑
 *
 ************************************************************************/
YX.fn.uploadFile = function() {
  var that = this,
    scene = this.crtSessionType,
    to = this.crtSessionAccount,
    fileInput = this.$fileInput.get(0);
  if (fileInput.files[0].size == 0) {
    alert('不能传空文件');
    return;
  }
  this.mysdk.sendFileMessage(scene, to, fileInput, this.sendMsgDone.bind(this));
};

YX.fn.chooseFile = function() {
  this.$fileInput.click();
};

YX.fn.sendTextMessage = function() {
  var scene = this.crtSessionType,
    to = this.crtSessionAccount,
    text = this.$messageText.val().trim();
  if (!!to && !!text) {
    if (text.length > 500) {
      alert('消息长度最大为500字符');
    } else if (text.length === 0) {
      return;
    } else {
      var options = {
        scene: scene || 'p2p',
        to: to,
        text: text,
        done: this.sendMsgDone.bind(this)
      };
      // 客户端反垃圾检查
      var ret = nim.filterClientAntispam({
        content: text
      });

      switch (ret.type) {
        case 0:
          // console.log('没有命中反垃圾词库', ret.result);
          break;
        case 1:
          // console.log('已对特殊字符做了过滤', ret.result);
          options.text = ret.result;
          break;
        case 2:
          // console.log('建议拒绝发送', ret.result);
          this.mysdk.sendTipMsg({
            scene: scene,
            to: to,
            tip: '命中敏感词，拒绝发送'
          });
          return;
        case 3:
          // console.log('建议服务器处理反垃圾，发消息带上字段clientAntiSpam';
          options.clientAntiSpam = true;
          break;
      }
      if (
        this.crtSessionType === 'team' &&
        this.crtSessionTeamType === 'advanced'
      ) {
        if ($('#needTeamMsgReceipt') && $('#needTeamMsgReceipt')[0].checked) {
          options.needMsgReceipt = true;
        }
      }
      this.nim.sendText(options);
    }
  }
};
/**
 * 发送消息完毕后的回调
 * @param error：消息发送失败的原因
 * @param msg：消息主体，类型分为文本、文件、图片、地理位置、语音、视频、自定义消息，通知等
 */
YX.fn.sendMsgDone = function(error, msg) {
  if (error && error.code === 7101) {
    alert('被拉黑');
    msg.blacked = true;
  }
  this.cache.addMsgs(msg);
  this.$messageText.val('');
  this.$chatContent.find('.no-msg').remove();
  this.cache.dealTeamMsgReceipts(msg, function () {
    var msgHtml = appUI.updateChatContentUI(msg, this.cache);
    this.$chatContent.append(msgHtml).scrollTop(99999);
    $('#uploadForm')
      .get(0)
      .reset();
  }.bind(this))
};

YX.fn.inputMessage = function(e) {
  var ev = e || window.event;
  if ($.trim(this.$messageText.val()).length > 0) {
    if (ev.keyCode === 13 && ev.ctrlKey) {
      this.$messageText.val(this.$messageText.val() + '\r\n');
    } else if (ev.keyCode === 13 && !ev.ctrlKey) {
      this.sendTextMessage();
    }
  }
};
// 重发
YX.fn.doResend = function(evt) {
  var $node;
  if (evt.target.tagName.toLowerCase() === 'span') {
    $node = $(evt.target);
  } else {
    $node = $(evt.target.parentNode);
  }
  var sessionId = $node.data('session');
  var idClient = $node.data('id');
  var msg = this.cache.findMsg(sessionId, idClient);
  this.mysdk.resendMsg(
    msg,
    function(err, data) {
      if (err) {
        alert(err.message || '发送失败');
      } else {
        this.cache.setMsg(sessionId, idClient, data);
        var msgHtml = appUI.buildChatContentUI(sessionId, this.cache);
        this.$chatContent.html(msgHtml).scrollTop(99999);
        $('#uploadForm')
          .get(0)
          .reset();
      }
    }.bind(this)
  );
};
/************************************************************
 * 获取当前会话消息
 * @return {void}
 *************************************************************/
YX.fn.getHistoryMsgs = function(scene, account) {
  var id = scene + '-' + account;
  var sessions = this.cache.findSession(id);
  var msgs = this.cache.getMsgs(id);
  //标记已读回执
  this.sendMsgRead(account, scene);
  if (!!sessions) {
    // if (sessions.unread >= msgs.length) {
    var end = msgs.length > 0 ? msgs[0].time : false;
    this.mysdk.getLocalMsgs(id, end, this.getLocalMsgsDone.bind(this));
    return;
    // }
  }
  this.doChatUI(id);
};
//拿到历史消息后聊天面板UI呈现
YX.fn.doChatUI = function(id) {
  this.cache.dealTeamMsgReceipts(id, function () {
    var temp = appUI.buildChatContentUI(id, this.cache);
    this.$chatContent.html(temp);
    this.$chatContent.scrollTop(9999);
    //已读回执UI处理
    this.markMsgRead(id);
  }.bind(this));
};

YX.fn.getLocalMsgsDone = function(err, data) {
  if (!err) {
    this.cache.addMsgsByReverse(data.msgs);
    var id = data.sessionId;
    var array = getAllAccount(data.msgs);
    var that = this;
    this.checkUserInfo(array, function() {
      that.doChatUI(id);
    });
  } else {
    alert('获取历史消息失败');
  }
};

//检查用户信息有木有本地缓存 没的话就去拿拿好后在执行回调
YX.fn.checkUserInfo = function(array, callback) {
  var arr = [];
  var that = this;
  for (var i = array.length - 1; i >= 0; i--) {
    if (!this.cache.getUserById(array[i])) {
      arr.push(array[i]);
    }
  }
  if (arr.length > 0) {
    this.mysdk.getUsers(arr, function(error, data) {
      if (!error) {
        that.cache.setPersonlist(data);
        callback();
      } else {
        alert('获取用户信息失败');
      }
    });
  } else {
    callback();
  }
};
//发送已读回执
YX.fn.sendMsgRead = function(account, scene) {
  if (scene === 'p2p') {
    var id = scene + '-' + account;
    var sessions = this.cache.findSession(id);
    this.mysdk.sendMsgReceipt(sessions.lastMsg, function(err, data) {
      if (err) {
        console.log(err);
      }
    });
  }
};
//UI上标记消息已读
YX.fn.markMsgRead = function(id) {
  if (!id || this.crtSession !== id) {
    return;
  }
  var msgs = this.cache.getMsgs(id);
  for (var i = msgs.length - 1; i >= 0; i--) {
    var message = msgs[i];
    // 目前不支持群已读回执
    if (message.scene === 'team') {
      return;
    }
    if (message.type !== 'tip' && window.nim.isMsgRemoteRead(message)) {
      $('.item.item-me.read').removeClass('read');
      $('#' + message.idClient).addClass('read');
      break;
    }
  }
};
//撤回消息
YX.fn.backoutMsg = function(id, data) {
  var msg = data ? data.msg : this.cache.findMsg(this.crtSession, id);
  var to = msg.target;
  var session = msg.sessionId;
  var opeAccount = msg.opeAccount || msg.from;
  var opeNick = getNick(opeAccount);
  if (msg.scene === 'team') {
    var teamId = msg.to || this.crtSessionAccount;
    var teamInfo = this.cache.getTeamById(teamId);
    if (teamInfo && opeAccount !== msg.from) {
      if (teamInfo.owner === opeAccount) {
        opeNick = '群主' + opeNick;
      } else if (teamInfo.type === 'advanced') {
        opeNick = '管理员' + opeNick;
      }
    }
  }

  this.nim.sendTipMsg({
    isLocal: true,
    scene: msg.scene,
    to: to,
    tip: (userUID === opeAccount ? '你' : opeNick) + '撤回了一条消息',
    time: msg.time,
    done: function(err, data) {
      if (!err) {
        this.cache.backoutMsg(session, id, data);
        if (this.crtSession === session) {
          var msgHtml = appUI.buildChatContentUI(this.crtSession, this.cache);
          this.$chatContent.html(msgHtml).scrollTop(99999);
          //已读回执UI处理
          this.markMsgRead(this.crtSession);
        }
      } else {
        alert('操作失败');
      }
    }.bind(this)
  });
};

/*********************************多人音视频模块********************************* */
/** 发送群视频tip消息
 * @param {object} option
 * @param {string} option.teamId 群id
 * @param {string} option.account 发送群视频的uid
 * @param {string} option.message tip消息
 */
YX.fn.sendTeamNetCallTip = function(option) {
  var tmpUser = this.cache.getTeamMemberInfo(option.account, option.teamId);
  option.nick = tmpUser.nickInTeam || getNick(option.account);

  option.isLocal = option.isLocal === undefined ? true : option.isLocal;
  /** 远程 先禁掉 */
  this.nim.sendTipMsg({
    isLocal: option.isLocal,
    scene: 'team',
    to: option.teamId,
    tip: getNick(option.nick) + option.message,
    time: Date.now(),
    isPushable: false,
    isHistoryable: false,
    isRoamingable: false,
    done: function(err, data) {
      // err && console.log(err)
      // this.buildSessions();
      // var msgHtml = appUI.buildChatContentUI(this.crtSession, this.cache)
      this.cache.addMsgs(data);
      var msgHtml = appUI.updateChatContentUI(data, this.cache);
      this.$chatContent.append(msgHtml).scrollTop(99999);
    }.bind(this)
  });
};

/** 对列表用户进行点对点发送自定义系统通知
 * @param {Array} list
 * @param {object} option
 * @param {string} option.caller 主叫人
 * @param {string} option.type 视频还是音频, 如果为空，则取消呼叫!
 * @param {string} option.list 被呼叫uid的列表
 * @param {string} option.teamId 群id
 * @param {string} option.channelName 房间id
 */
YX.fn.sendCustomMessage = function(option) {
  var that = this;
  option.list = option.list || [];

  var tmpUser = this.cache.getTeamMemberInfo(option.caller, option.teamId);
  option.nick = tmpUser.nickInTeam || getNick(option.caller);

  option.list.forEach(function(uid) {
    // this.mysdk.sendCustomMessage('p2p', item, content, this.sendMsgDone.bind(this))
    that.nim.sendCustomSysMsg({
      scene: 'p2p',
      to: uid,
      enablePushNick: false,
      content: JSON.stringify({
        id: 3,
        members: option.list,
        teamId: option.teamId,
        room: option.channelName,
        type: option.type
      }),
      isPushable: true,
      sendToOnlineUsersOnly: false,
      apnsText: option.nick + '正在呼叫您',
      done: function(error, msg) {
        console.log(msg);
      }
    });
  });
};
