const redis = require('redis');

const client = redis.createClient();

const express = require('express');

const app = express();

const request = require('superagent');

const reviewers = ['ekoshairy', 'Hodahamad'];
let reviewerId = 0;
const authToken = process.env.TOKEN;
const mustPass = ['NAME="Style Check" STYLECHECK=true'];
const niceToHave = ['continuous-integration/travis-ci/pr', 'NAME="Public Tests" STYLECHECK=false TESTFOLDER=spec'];
let pr = {};
let shapr = {};

client.on('error', err => console.log(`Error ${err}`)); // handling redis errors;

const updateRedis = () => {
  console.log('updating redis data');
  client.set('pr', JSON.stringify(pr));
  client.set('shapr', JSON.stringify(shapr));
};

const loadRedis = () => {
  console.log('loading data from redis');
  console.log(client.get('pr'));
  client.get('pr', (err, reply) => {
    pr = JSON.parse(reply) || {};
  });

  client.get('shapr', (err, reply) => {
    shapr = JSON.parse(reply) || {};
  });
};

const setReviewer = () => {
  if (reviewerId === reviewers.length - 1) reviewerId = 0;
  else { reviewerId += 1; }
};

const addReviewer = (owner, repo, number, callback) => {
  // using almakinah bot's/ actually using saher's auth token to set reviewer.
  // if reopening a pull request, do I remove current reviewer before adding new
  // one?
  const reviewer = reviewers[reviewerId];
  console.log('reviewer is', reviewer);
  request
    .post(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`)
    .set('Authorization', `token ${authToken}`)
    .send({ reviewers: [reviewer] })
    .end((err, res) => {
      console.log(`data regarding reviewer: ${JSON.stringify(err)} - ${JSON.stringify(res)}`);
      setReviewer();
      callback(err, res);
    });
};

const addChecklist = (owner, repo, number, callback) => {
  request
    .post(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`)
    .set('Authorization', `token ${authToken}`)
    .send({ body: 'Have you completed the following? \n- [ ] added files\n- [ ] broke stuff\n' })
    .end((err, res) => {
      console.log(`data regarding checklist: ${JSON.stringify(err)} - ${JSON.stringify(res)}`);
      callback(err, res);
    });
};

// returns true when can merge
const checkPRStatus = (number, repo) => {
  console.log('in status');
  console.log(pr);
  let failed = false;
  if (pr[repo] && pr[repo][number]) {
    console.log(pr[repo][number].checks);
    Object.keys(pr[repo][number].checks).forEach((key, i) => {
      if (!pr[repo][number].checks[key]) {
        failed = true;
        return false;
      }
      return !failed;
    });
    return !failed;
  }
  return false;
};

const merge = (details, callback) => {
  const { number } = details;
  const { repo } = details;
  console.log(number);
  console.log(repo);
  if (pr[repo][number].status === 2) {
    request
      .put(`https://api.github.com/repos/${pr[repo][number].owner}/${repo}/pulls/${number}/merge`)
      .set('Authorization', `token ${authToken}`)
      .send({ commit_title: 'auto merge', commit_message: 'All checks passed', sha: pr[repo][number].sha })
      .end((err, res) => {
        console.log(`data regarding reviewer: ${JSON.stringify(err)} - ${JSON.stringify(res)}`);
        // delete pr object
        console.log('deleting pr and shapr');
        delete shapr[pr[repo][number].sha];
        delete pr[repo][number];
        updateRedis();
        console.log(pr);
        console.log(shapr);
        callback(err, res);
      });
  } else {
    console.log('not automerging');
  }
};

const checkTitle = (title, repo, number) => {
  if (title.match(/^wip/i)) {
    // don't auto merge
    pr[repo][number].status = 1;
  } else if (title.match(/hotfix/i)) {
    // do nothing - currently same as above
    pr[repo][number].status = 0;
  } else {
    pr[repo][number].status = 2;
  }
  updateRedis();
};

const checkCommand = (command, repo, number) => {
  if (command.match(/^\/enable automerge/i)) {
    pr[repo][number].status = 2;
  } else if (command.match(/^\/disable automerge/i)) {
    pr[repo][number].status = 1;
  }
  updateRedis();
};

const handlers = {
  edited(body, callback) {
    const { title } = body.pull_request;
    checkTitle(title, body.repository.name, body.number);
  },
  opened(body, callback) {
    console.log('Pull request open');
    console.log(body);
    const owner = body.repository.owner.login;
    const repo = body.repository.name;
    const { number } = body;

    // initialize pr object
    shapr[body.pull_request.head.sha] = number;

    pr[repo] = pr[repo] || {};

    // status:0 -> do nothing - currently same as 1
    // status:1 -> no automerge
    // status:2 -> do everything
    pr[repo][number] = {
      status: 2,
      owner,
      repo,
      sha: body.pull_request.head.sha,
      checks: {
        checked: null,
        approved: null,
      },
    };

    checkTitle(body.pull_request.title, repo, number);

    mustPass.forEach((e, i) => {
      pr[repo][number].checks[e] = null;
    });

    // Add reviewer and checklist
    addReviewer(owner, repo, number, (err, res) => {
      addChecklist(owner, repo, number, (err, res) => {
        callback(false, { success: true });
        updateRedis();
      });
    });
  },
  newCommit(body, callback) {
    console.log('Pull request new commit');
    console.log(body);
    const owner = body.repository.owner.login;
    const repo = body.repository.name;
    const number = shapr[body.before];

    // initialize pr object
    delete shapr[body.before];
    shapr[body.after] = number;
    const statusOld = pr[repo][number].status;
    pr[repo][number] = {
      status: statusOld,
      owner,
      repo,
      sha: body.after,
      checks: {
        checked: null,
        approved: null,
      },
    };

    mustPass.forEach((e, i) => {
      pr[repo][number].checks[e] = null;
    });

    // add new reviewer and checklist
    addReviewer(owner, repo, number, (err, res) => {
      addChecklist(owner, repo, number, (err, res) => {
        callback(false, { success: true });
        updateRedis();
      });
    });
  },
  handlePullRequest(body, callback) {
    console.log("I'm in here, handling travis");
    console.log(body.sha);
    console.log(shapr);
    console.log(pr);
    if (body.context && mustPass.includes(body.context)) {
      // succeeds only if sha matches sha
      const repo = body.repository.name;
      const number = shapr[body.sha];
      pr[repo][number].checks[body.context] = (body.state === 'success');
    }
    updateRedis();
    callback(null, { number: shapr[body.sha], repo: body.repository.name });
  },
  handleReview(body, callback) {
    console.log(body.review.state);
    const { number } = body.pull_request;
    const repo = body.repository.name;
    const sha = body.review.commit_id;
    if (body.review.state === 'approved') {
      if (shapr[sha] === number) { // making sure the review is the latest.
        pr[repo][number].checks.approved = true;
      }
      updateRedis();
      callback(null, { number, repo });
    } else {
      if (shapr[sha] === number) {
        pr[repo][number].checks.approved = false;
      }
      updateRedis();
      callback(null, { number, repo });
    }
  },
  handleComment(body, callback) {
    console.log(body.comment);
    const { number } = body.issue;
    const repo = body.repository.name;
    if (body.comment.body.match(/- \[ \]/) === null) {
      console.log('all are checked, can merge');
      pr[repo][number].checks.checked = true;
    } else {
      pr[repo][number].checks.checked = false;
      console.log("not done yet, can't merge");
    }
    updateRedis();
    callback(null, { number, repo });
  },
};

// ROUTES FOR OUR API
// =============================================================================
const router = express.Router(); // get an instance of the express Router

app.use(express.json());

router.get('/', (req, res) => {
  res.json({ success: true });
});

router.post('/*', (req, res) => {
  const { action } = req.body;
  const event = req.get('X-GitHub-Event');
  console.log('event is ', event);
  console.log('shapr:');
  console.log(shapr);
  console.log('pr:');
  console.log(pr);
  if (req.body.pull_request && (action === 'opened' || action === 'created' || action === 'reopened') && req.body.pull_request.state === 'open') {
    handlers.opened(req.body, (err, result) => res.json(result));
  } else if (req.body.pull_request && (action === 'edited') && req.body.pull_request.state === 'open') {
    handlers.edited(req.body, (err, result) => res.json(result));
  } else if (event === 'pull_request_review') {
    const { number } = req.body.pull_request;
    const repo = req.body.repository.name;
    // if(pr[repo][number]['status'] > 0) {
    handlers.handleReview(req.body, (err, result) => {
      if (checkPRStatus(result.number, result.repo)) merge(result, (err, result) => res.json(result));
      else res.json(result);
    });
    // } else {
    //  res.json({output: 'nothing'});
    // }
  } else if (event === 'issue_comment' && action !== 'created') {
    const { number } = req.body.issue;
    const repo = req.body.repository.name;
    // if(pr[repo][number]['status'] > 0) {
    handlers.handleComment(req.body, (err, result) => {
      if (checkPRStatus(result.number, result.repo)) merge(result, (err, result) => res.json(result));
      else res.json(result);
    });
    // } else {
    //  res.json({output: 'nothing'});
    // }
  // Adding Commands to enable and disable automerge through github comments
  } else if (event === 'issue_comment' && action === 'created') {
    const { number } = req.body.issue;
    const repo = req.body.repository.name;
    checkCommand(req.body.comment.body, repo, number);
    console.log(pr);
    if (checkPRStatus(number, repo)) merge({ number, repo }, (err, result) => res.json(result));
    else { res.json({ number, repo }); }
  } else if (event === 'status' && req.body.state !== 'pending') {
    const repo = req.body.repository.name;
    const number = shapr[req.body.sha];

    // CONTINUE HERE IS THERE ARE A BETTER WAY??
    // if(pr[repo][number]['status'] > 0) {
    handlers.handlePullRequest(req.body, (err, result) => {
      if (checkPRStatus(result.number, result.repo)) merge(result, (err, result) => res.json(result));
      else res.json(result);
    });
    // } else {
    //  res.json({output: 'nothing'});
    // }
  } else if (event === 'push' && shapr[req.body.before] && pr[req.body.repository.name][shapr[req.body.before]]) {
    // instead can use event === 'pull_request' && action =' synchronized'
    // synchronized basically means a new commit in current pull request.
    // if pushing into a branch currently under pull request, must handle, else,
    // ignore
    handlers.newCommit(req.body, (err, result) => res.json(result));
  } else {
    res.json({ success: false, payload: `un-mached handler: ${action}` });
  }
});


// REGISTER OUR ROUTES -------------------------------
// all of our routes will be prefixed with /api
app.use('/webhooks/', router);

// START THE SERVER
// =============================================================================
const port = process.env.PORT || 9090; // set our port
app.listen(port);
console.log(`Magic happens on port ${port}`);
loadRedis();

export default app;
