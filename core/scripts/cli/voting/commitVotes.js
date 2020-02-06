const inquirer = require("inquirer");
const style = require("../textStyle");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const filterRequests = require("./filterRequestsByRound");
const { VotePhasesEnum } = require("../../../../common/Enums");
const constructCommitment = require("./constructCommitment");
const batchCommitVotes = require("./batchCommitVotes");

module.exports = async (web3, voting) => {
  style.spinnerReadingContracts.start();
  const pendingRequests = await voting.getPendingRequests();
  const roundId = await voting.getCurrentRoundId();
  const roundPhase = await voting.getVotePhase();
  const account = await getDefaultAccount(web3);
  const filteredRequests = await filterRequests(pendingRequests, account, roundId, roundPhase, voting);
  style.spinnerReadingContracts.stop();

  if (roundPhase.toString() === VotePhasesEnum.REVEAL) {
    console.log(
      `The current vote phase is the "reveal" phase; in the reveal phase, you can only reveal already committed votes. You cannot vote on price requests in this phase.`
    );
  } else if (filteredRequests.length === 0) {
    console.log(`No pending price requests to commit votes for!`);
  } else {
    console.group(`${style.bgRed(`\nPlease select which price requests you would like to commit votes for`)}`);

    // To display properly, give each request a 'value' parameter
    for (let i = 0; i < filteredRequests.length; i++) {
      let request = filteredRequests[i];
      request.value = `${web3.utils.hexToUtf8(request.identifier)} @ ${style.formatSecondsToUtc(
        parseInt(request.time)
      )}`;
    }

    const checkbox = await inquirer.prompt({
      type: "checkbox",
      name: "requestsCheckbox",
      message: `After selecting which requests you want to vote on, you will be prompted to manually enter in a price for each request. You can change these votes later.`,
      choices: filteredRequests
    });
    if (checkbox["requestsCheckbox"]) {
      console.log(
        style.bgRed(
          `Next, enter prices for the selected requests. Prices must be positive numbers, invalid input will default to 0.`
        )
      );

      const newCommitments = [];
      const failures = [];

      // Prompt user to enter a price per vote construct commitments for the votes
      const selections = checkbox["requestsCheckbox"];
      for (let i = 0; i < selections.length; i++) {
        // Prompt user to enter a price per vote and commit the votes
        const priceInput = await inquirer.prompt({
          type: "number",
          name: "price",
          default: 0,
          message: style.bgRed(`Price for ${selections[i]}:`),
          validate: value => value >= 0 || "Price must be positive"
        });

        // Look up raw request data from checkbox value
        let selectedRequest;
        for (let j = 0; j < filteredRequests.length; j++) {
          let request = filteredRequests[j];
          if (request.value === selections[i]) {
            selectedRequest = request;
            break;
          }
        }

        // Construct commitment
        try {
          newCommitments.push(await constructCommitment(selectedRequest, roundId, web3, priceInput["price"], account));
        } catch (err) {
          failures.push({ selectedRequest, err });
        }
      }

      // Batch commit the votes and display a receipt to the user
      if (newCommitments.length > 0) {
        const { successes, batches } = await batchCommitVotes(newCommitments, voting, account);

        // Print results
        console.log(
          style.bgGreen(
            `You have successfully committed ${successes.length} price${
              successes.length === 1 ? "" : "s"
            } in ${batches} batch${batches === 1 ? "" : "es"}. (Failures = ${failures.length})`
          )
        );
        console.group(style.bgGreen(`Receipts:`));
        for (let i = 0; i < successes.length; i++) {
          console.log(`- transaction: ${style.link(`https://etherscan.io/tx/${successes[i].txnHash}`)}`);
          console.log(`    - salt: ${successes[i].salt}`);
        }
        console.groupEnd();
      } else {
        console.log(`You have not entered valid prices for any votes`);
      }
    } else {
      console.log(`You have not selected any requests.`);
    }
    console.log(`\n`);
    console.groupEnd();
  }
};
